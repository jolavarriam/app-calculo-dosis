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
  vol1: { required: true, min: 0.01, max: 10, label: "Volumen (L) / 20 s — muestra 1" },
  vol2: { required: true, min: 0.01, max: 10, label: "Volumen (L) / 20 s — muestra 2" },
  vol3: { required: true, min: 0.01, max: 10, label: "Volumen (L) / 20 s — muestra 3" },
  anchoBoquilla: { required: true, min: 0.05, max: 50, label: "Ancho de boquilla (m)" },
  avanceMs: { required: true, min: 0.05, max: 5, label: "Avance (m/s)" },
  areaEnsayo: { required: true, min: 1, max: 100000, label: "Área de ensayo (m²)" },
  remanente: { required: false, min: 0, max: 200, default: 0.8, label: "Remanente mochila (L)" },
  caldoPreparar: { required: true, min: 0.01, max: 100000, label: "Caldo a preparar (L)" },
  productoHa: { required: true, min: 0.001, max: 1000, label: "Producto por hectárea" },
};

const form = document.getElementById("calcForm");

const nf2 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Lee y valida un campo. Devuelve { value, error, isEmpty } */
function readField(id) {
  const rule = FIELD_RULES[id];
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

function recalculate() {
  // --- Leer y validar todos los campos ---
  const results = {};
  for (const id of Object.keys(FIELD_RULES)) {
    results[id] = readField(id);
    paintField(id, results[id]);
  }

  // --- 1. Calibración de boquilla ---
  const gasto = { vol1: null, vol2: null, vol3: null };
  ["vol1", "vol2", "vol3"].forEach((id, i) => {
    const r = results[id];
    const value = r.error ? null : r.value * 3;
    gasto[id] = value;
    paintComputed(`gasto${i + 1}`, value, nf2, "L/min", !!r.error);
  });

  const gastoValues = ["vol1", "vol2", "vol3"].map((id) => gasto[id]);
  const gastoValid = gastoValues.every((v) => v !== null);
  const gastoProm = gastoValid
    ? (gastoValues[0] + gastoValues[1] + gastoValues[2]) / 3
    : null;
  paintComputed("gastoProm", gastoProm, nf2, "L/min", !gastoValid);

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
}

// Recalcular al instante con cada tecla / cambio
form.addEventListener("input", recalculate);
form.addEventListener("submit", (e) => e.preventDefault());

// Primer cálculo al cargar (por si el navegador restaura valores del formulario)
recalculate();
