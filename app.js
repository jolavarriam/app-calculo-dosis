/* ---------------------------------------------------------------
   Tema claro / oscuro (con memoria en localStorage)
--------------------------------------------------------------- */
const THEME_KEY = "dosis-app-theme";
const themeToggle = document.getElementById("themeToggle");
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
const THEME_COLORS = { light: "#f7f7f5", dark: "#0f172a" };

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (e) {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    /* localStorage no disponible (modo privado, etc.): el tema no se recordará */
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  if (metaThemeColor) metaThemeColor.setAttribute("content", THEME_COLORS[theme]);
}

// El <script> del <head> ya aplicó el tema correcto antes de pintar;
// aquí solo sincronizamos el estado del botón con lo que quedó aplicado.
let currentTheme = document.documentElement.getAttribute("data-theme") || "light";
applyTheme(currentTheme);

themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(currentTheme);
  storeTheme(currentTheme);
});

// Si el usuario nunca eligió manualmente un tema, seguir el tema del sistema en vivo
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
systemThemeQuery.addEventListener("change", (event) => {
  if (getStoredTheme()) return; // ya eligió un tema manualmente, no lo pisamos
  currentTheme = event.matches ? "dark" : "light";
  applyTheme(currentTheme);
});

/* ---------------------------------------------------------------
   Estado de conexión + PWA (igual que antes)
--------------------------------------------------------------- */
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");

function updateOnlineStatus() {
  const online = navigator.onLine;
  statusEl.classList.toggle("is-online", online);
  statusEl.classList.toggle("is-offline", !online);
  statusText.textContent = online
    ? "Conectado a internet"
    : "Sin conexión (funcionando offline)";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then((reg) => console.log("Service Worker registrado:", reg.scope))
      .catch((err) => console.error("Error al registrar Service Worker:", err));
  });
}

let deferredPrompt;
const installBtn = document.getElementById("installBtn");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  installBtn.hidden = true;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});
window.addEventListener("appinstalled", () => {
  installBtn.hidden = true;
});

/* ---------------------------------------------------------------
   Calculadora de dosis de aplicación
   Replica el modelo del Excel "Calculo_Dosis_app":
     1. Calibración de boquilla   -> gasto de boquilla (L/min)
     2. Ancho de boquilla (m)
     3. Avance (m/s -> m/min)
     4. Cobertura (m²/min)
     5. Mojamiento (L/ha)
     6. Área de ensayo (m²)
     7. Caldo (L) + remanente mochila
     8. Dosis (g o mL por carga de caldo)
--------------------------------------------------------------- */

// Reglas de validación por campo. Los rangos son referenciales (para
// detectar valores fuera de lo razonable o mal ingresados), no límites
// normativos.
const FIELD_RULES = {
  anchoBoquilla: { required: true, min: 0.05, max: 50, label: "Ancho de boquilla (m)" },
  avanceMs: { required: true, min: 0.05, max: 5, label: "Avance (m/s)" },
  areaEnsayo: { required: true, min: 1, max: 100000, label: "Área de ensayo (m²)" },
  remanente: { required: false, min: 0, max: 200, default: 0.8, label: "Remanente mochila (L)" },
  caldoPreparar: { required: true, min: 0.01, max: 100000, label: "Caldo a preparar (L)" },
  productoHa: { required: true, min: 0.001, max: 1000, label: "Producto por hectárea" },
};

const SAMPLE_RULE = { required: true, min: 0.01, max: 10 };
const MAX_SAMPLES = 20;

const form = document.getElementById("calcForm");
const calibRowsEl = document.getElementById("calibRows");
const addSampleBtn = document.getElementById("addSampleBtn");

// Snapshot del último cálculo válido, usado por el botón "Generar PDF"
let lastReportState = null;
let formIsValid = false;

const nf2 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function pdfFileStamp() {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Lee y valida un campo según una regla dada. Devuelve { value, error, isEmpty } */
function readField(id, rule) {
  const input = document.getElementById(id);
  const raw = input.value.trim();

  if (raw === "") {
    if (rule.required) {
      return { value: null, error: "Este campo es obligatorio.", isEmpty: true };
    }
    // Opcional y vacío: válido, sin valor (el llamador aplica su propio fallback)
    return { value: null, error: null, isEmpty: true };
  }

  const num = Number(raw.replace(",", "."));
  if (Number.isNaN(num)) {
    return { value: null, error: "Ingresa un número válido.", isEmpty: false };
  }
  if (num < rule.min || num > rule.max) {
    return {
      value: null,
      error: `Debe estar entre ${rule.min} y ${rule.max}.`,
      isEmpty: false,
    };
  }
  return { value: num, error: null, isEmpty: false };
}

/** Pinta el estado (válido / inválido / mensaje) de un input */
function paintField(id, result) {
  const input = document.getElementById(id);
  const errorEl = document.getElementById(`err-${id}`);
  input.classList.remove("is-invalid", "is-valid");

  if (result.error) {
    input.classList.add("is-invalid");
    errorEl.textContent = result.error;
  } else {
    errorEl.textContent = "";
    if (!result.isEmpty) input.classList.add("is-valid");
  }
}

/** Escribe un valor calculado en un <output>, o "–" si no se puede calcular */
function paintComputed(id, value, formatter, suffix = "", errorState = false) {
  const el = document.getElementById(id);
  el.classList.toggle("has-error", errorState);
  if (value === null || value === undefined || errorState) {
    el.textContent = "–" + (suffix ? ` ${suffix}` : "");
  } else {
    el.textContent = `${formatter.format(value)}${suffix ? " " + suffix : ""}`;
  }
}

/* ---------------------------------------------------------------
   Muestras de calibración dinámicas (agregar / eliminar)
--------------------------------------------------------------- */
let sampleUids = [1];
let nextSampleUid = 2;

const sampleFieldId = (uid) => `vol-${uid}`;
const sampleGastoId = (uid) => `gasto-${uid}`;

function renderCalibRows() {
  // Guarda los valores ya ingresados antes de reconstruir las filas, para
  // no perderlos al agregar o eliminar una muestra.
  const savedValues = {};
  sampleUids.forEach((uid) => {
    const input = document.getElementById(sampleFieldId(uid));
    if (input) savedValues[uid] = input.value;
  });

  calibRowsEl.innerHTML = sampleUids
    .map((uid, index) => {
      const canRemove = sampleUids.length > 1;
      return `
        <div class="calib-row" data-uid="${uid}">
          <span class="calib-row__label">${index + 1}</span>
          <div class="field">
            <input type="number" id="${sampleFieldId(uid)}" step="0.01" min="${SAMPLE_RULE.min}" max="${SAMPLE_RULE.max}" placeholder="Ej: 0,45" required />
            <span class="field__error" id="err-${sampleFieldId(uid)}"></span>
          </div>
          <output class="computed" id="${sampleGastoId(uid)}">–</output>
          <button
            type="button"
            class="remove-sample-btn"
            data-remove-uid="${uid}"
            ${canRemove ? "" : "disabled"}
            aria-label="Eliminar muestra ${index + 1}"
            title="Eliminar muestra"
          >
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"></path>
              <path d="M6.5 7l0.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7"></path>
              <path d="M10 11v6M14 11v6"></path>
            </svg>
          </button>
        </div>`;
    })
    .join("");

  // Restaura los valores guardados en los inputs recién creados
  sampleUids.forEach((uid) => {
    const input = document.getElementById(sampleFieldId(uid));
    if (input && savedValues[uid] !== undefined) input.value = savedValues[uid];
  });

  addSampleBtn.hidden = sampleUids.length >= MAX_SAMPLES;
}

addSampleBtn.addEventListener("click", () => {
  if (sampleUids.length >= MAX_SAMPLES) return;
  const newUid = nextSampleUid++;
  sampleUids.push(newUid);
  renderCalibRows();
  recalculate();
  const newInput = document.getElementById(sampleFieldId(newUid));
  if (newInput) newInput.focus();
});

calibRowsEl.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-uid]");
  if (!btn || btn.disabled || sampleUids.length <= 1) return;
  const uid = Number(btn.dataset.removeUid);
  sampleUids = sampleUids.filter((u) => u !== uid);
  renderCalibRows();
  recalculate();
});

renderCalibRows();

function recalculate() {
  // --- 1. Calibración de boquilla (muestras dinámicas) ---
  const sampleResults = sampleUids.map((uid) => {
    const r = readField(sampleFieldId(uid), SAMPLE_RULE);
    paintField(sampleFieldId(uid), r);
    return { uid, ...r };
  });

  const gastoBySample = sampleResults.map((r) => (r.error ? null : r.value * 3));
  sampleResults.forEach((r, i) => {
    paintComputed(sampleGastoId(r.uid), gastoBySample[i], nf2, "L/min", !!r.error);
  });

  const gastoValid = gastoBySample.length > 0 && gastoBySample.every((v) => v !== null);
  const gastoProm = gastoValid
    ? gastoBySample.reduce((a, b) => a + b, 0) / gastoBySample.length
    : null;
  paintComputed("gastoProm", gastoProm, nf2, "L/min", !gastoValid);

  // --- Leer y validar el resto de los campos ---
  const results = {};
  for (const id of Object.keys(FIELD_RULES)) {
    results[id] = readField(id, FIELD_RULES[id]);
    paintField(id, results[id]);
  }

  // --- 2. Ancho de boquilla ---
  const anchoOk = !results.anchoBoquilla.error;
  const ancho = anchoOk ? results.anchoBoquilla.value : null;

  // --- 3. Avance ---
  const avanceOk = !results.avanceMs.error;
  const avanceMs = avanceOk ? results.avanceMs.value : null;
  const avanceMmin = avanceOk ? avanceMs * 60 : null;
  paintComputed("avanceMmin", avanceMmin, nf1, "m/min", !avanceOk);

  // --- 4. Cobertura (m²/min) ---
  const coberturaOk = anchoOk && avanceOk;
  const m2min = coberturaOk ? ancho * avanceMmin : null;
  paintComputed("m2min", m2min, nf2, "m²/min", !coberturaOk);

  // --- 5. Mojamiento (L/ha) ---
  const mojamientoOk = coberturaOk && gastoValid && m2min > 0;
  const mojamiento = mojamientoOk ? (gastoProm * 10000) / m2min : null;
  paintComputed("mojamiento", mojamiento, nf0, "L/ha", !mojamientoOk);

  // --- 6. Área de ensayo ---
  const areaOk = !results.areaEnsayo.error;
  const area = areaOk ? results.areaEnsayo.value : null;

  // --- 7. Caldo ---
  const caldoCalcOk = mojamientoOk && areaOk;
  const caldoCalc = caldoCalcOk ? (mojamiento * area) / 10000 : null;
  paintComputed("caldoCalc", caldoCalc, nf2, "L", !caldoCalcOk);

  // Remanente: si está vacío, se usa el valor por defecto (0,8 L)
  const remanenteResult = results.remanente;
  let remanenteOk = true;
  let remanente = FIELD_RULES.remanente.default;
  if (remanenteResult.error) {
    remanenteOk = false;
  } else if (!remanenteResult.isEmpty) {
    remanente = remanenteResult.value;
  }

  const caldoTotalOk = caldoCalcOk && remanenteOk;
  const caldoTotal = caldoTotalOk ? caldoCalc + remanente : null;
  paintComputed("caldoTotal", caldoTotal, nf2, "L", !caldoTotalOk);

  // Caldo a preparar: volumen real que se cargará (redondeado a la capacidad
  // del estanque/mochila). Es obligatorio: la dosis final se calcula sobre
  // este valor, no sobre el caldo total calculado.
  const caldoPrepararResult = results.caldoPreparar;
  const noteEl = document.getElementById("note-caldoPreparar");
  const defaultNote =
    "Usa el caldo total calculado como referencia y ajústalo a la capacidad real de tu estanque o mochila.";

  let caldoEfectivo = null;
  let caldoEfectivoOk = false;

  if (!caldoPrepararResult.error && !caldoPrepararResult.isEmpty) {
    caldoEfectivo = caldoPrepararResult.value;
    caldoEfectivoOk = true;
    if (caldoCalcOk && caldoEfectivo < caldoCalc) {
      noteEl.textContent = `Atención: es menos que el caldo necesario calculado (${nf2.format(caldoCalc)} L). La mezcla podría no alcanzar para cubrir el área.`;
      noteEl.classList.add("is-warning");
    } else {
      noteEl.textContent = defaultNote;
      noteEl.classList.remove("is-warning");
    }
  } else {
    noteEl.textContent = defaultNote;
    noteEl.classList.remove("is-warning");
  }

  // --- 8. Dosis final ---
  const productoOk = !results.productoHa.error;
  const producto = productoOk ? results.productoHa.value : null;

  const dosisOk = productoOk && caldoEfectivoOk && mojamientoOk && mojamiento > 0;
  const dosis = dosisOk ? (producto * caldoEfectivo * 1000) / mojamiento : null;

  const dosisEl = document.getElementById("dosisResultado");
  dosisEl.classList.toggle("has-error", !dosisOk);
  dosisEl.textContent = dosisOk ? nf2.format(dosis) : "Completa los campos requeridos";

  // --- Snapshot para el informe PDF ---
  const anyFieldError = Object.values(results).some((r) => r.error) || sampleResults.some((r) => r.error);
  formIsValid = !anyFieldError && dosisOk;

  lastReportState = {
    fileName: `DosisCalc-informe-${pdfFileStamp()}.pdf`,
    samples: sampleResults.map((r, i) => ({
      label: `Muestra ${i + 1}`,
      volume: r.error ? "–" : nf2.format(r.value),
      gasto: gastoBySample[i] !== null ? nf2.format(gastoBySample[i]) : "–",
    })),
    gastoPromedio: { value: gastoProm !== null ? nf2.format(gastoProm) : "–", unit: "L/min" },
    rightColumnSections: [
      {
        title: "2. Ancho de boquilla",
        rows: [{ label: "Ancho de boquilla", value: nf2.format(ancho ?? 0), unit: "m" }],
      },
      {
        title: "3. Velocidad de avance",
        rows: [
          { label: "Avance", value: nf2.format(avanceMs ?? 0), unit: "m/s" },
          { label: "Avance", value: avanceMmin !== null ? nf1.format(avanceMmin) : "–", unit: "m/min" },
        ],
      },
      {
        title: "4. Cobertura",
        rows: [{ label: "Superficie cubierta", value: m2min !== null ? nf2.format(m2min) : "–", unit: "m²/min" }],
      },
      {
        title: "5. Mojamiento",
        rows: [{ label: "Mojamiento", value: mojamiento !== null ? nf0.format(mojamiento) : "–", unit: "L/ha" }],
      },
      {
        title: "6. Área de ensayo",
        rows: [{ label: "Área de ensayo", value: nf2.format(area ?? 0), unit: "m²" }],
      },
    ],
    bottomSections: [
      {
        title: "7. Caldo",
        rows: [
          { label: "Caldo necesario (calculado)", value: caldoCalc !== null ? nf2.format(caldoCalc) : "–", unit: "L" },
          { label: "Remanente mochila", value: nf2.format(remanente), unit: "L" },
          { label: "Caldo total (calculado)", value: caldoTotal !== null ? nf2.format(caldoTotal) : "–", unit: "L" },
          { label: "Caldo a preparar (ingresado)", value: caldoEfectivo !== null ? nf2.format(caldoEfectivo) : "–", unit: "L" },
        ],
      },
      {
        title: "8. Dosis",
        rows: [{ label: "Producto por hectárea", value: nf2.format(producto ?? 0), unit: "kg o L/ha" }],
      },
    ],
    finalResult: {
      label: "Dosis por carga de caldo",
      value: dosisOk ? nf2.format(dosis) : "–",
      unit: "g (o mL) por carga",
    },
  };
}

// Recalcular al instante con cada tecla / cambio
form.addEventListener("input", recalculate);
form.addEventListener("submit", (e) => e.preventDefault());

// Primer cálculo al cargar (por si el navegador restaura valores del formulario)
recalculate();

/* ---------------------------------------------------------------
   Botón "Generar PDF"
--------------------------------------------------------------- */
const pdfBtn = document.getElementById("pdfBtn");
const pdfMessage = document.getElementById("pdfMessage");

function showPdfMessage(text, isError) {
  pdfMessage.textContent = text;
  pdfMessage.classList.toggle("is-error", !!isError);
  pdfMessage.classList.toggle("is-success", !isError);
}

pdfBtn.addEventListener("click", () => {
  if (!formIsValid || !lastReportState) {
    showPdfMessage(
      "Completa correctamente todos los campos requeridos antes de generar el PDF.",
      true
    );
    // Llevar al usuario al primer campo con error
    const firstInvalid = form.querySelector(".is-invalid, input:invalid");
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid.focus({ preventScroll: true });
    }
    return;
  }

  if (!window.DosisPDF) {
    showPdfMessage(
      "El generador de PDF aún no está listo. Si es la primera vez que usas la app, revisa tu conexión e inténtalo de nuevo.",
      true
    );
    return;
  }

  try {
    pdfBtn.disabled = true;
    window.DosisPDF.generate(lastReportState);
    showPdfMessage("PDF generado. Revisa tu carpeta de descargas.", false);
  } catch (err) {
    console.error("Error al generar el PDF:", err);
    showPdfMessage(
      "No se pudo generar el PDF. Si es la primera vez que usas la app, revisa tu conexión e inténtalo de nuevo.",
      true
    );
  } finally {
    pdfBtn.disabled = false;
  }
});
