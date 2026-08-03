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
     1. Calibración de boquilla (3 muestras fijas) -> gasto (L/min)
     2. Ancho de boquilla (m)
     3. Avance (m/s -> m/min)
     4. Cobertura (m²/min)
     5. Mojamiento (L/ha)
     6. Área de ensayo (m²)
     7. Caldo (L) + remanente mochila
     8. Tratamientos: 1 o más, cada uno con hasta 3 productos
        (nombre + dosis kg o L/ha -> dosis por carga calculada) y un
        remanente propio (solo para el informe)
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
};

// La calibración de boquilla siempre usa 3 muestras fijas.
const SAMPLE_RULE = { required: true, min: 0.01, max: 10 };
const SAMPLE_IDS = ["vol-1", "vol-2", "vol-3"];

// Tratamientos: 1 o más (máx. 30), cada uno con 1 a 3 productos.
const PRODUCT_DOSIS_RULE = { required: true, min: 0.001, max: 1000, label: "Dosis (kg o L/ha)" };
const TREATMENT_REMANENTE_RULE = { required: true, min: 0, max: 200, label: "Remanente (L)" };
const MAX_PRODUCTS_PER_TREATMENT = 3;
const MAX_TREATMENTS = 30;

const form = document.getElementById("calcForm");

// Snapshot del último cálculo válido, usado por el botón "Generar PDF"
let lastReportState = null;
let formIsValid = false;

const nf2 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Recorta los ceros sobrantes a la derecha de la coma decimal, solo para el
 * texto que se muestra en el PDF (ej. "220,00" -> "220", "22,10" -> "22,1").
 * La calculadora en pantalla sigue mostrando siempre 2 (o 1) decimales.
 */
function pdfTrim(text) {
  if (typeof text !== "string") return text;
  return text.replace(/(\d+),(\d+)/g, (match, intPart, decPart) => {
    const trimmed = decPart.replace(/0+$/, "");
    return trimmed ? `${intPart},${trimmed}` : intPart;
  });
}

function pdfFileStamp() {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Lee y valida un campo numérico según una regla dada. Devuelve { value, error, isEmpty } */
function readField(id, rule) {
  const input = document.getElementById(id);
  if (!input) return { value: null, error: null, isEmpty: true };
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

/** Lee y valida un campo de texto (p.ej. nombre de producto). */
function readTextField(id, { required }) {
  const input = document.getElementById(id);
  if (!input) return { value: null, error: null, isEmpty: true };
  const raw = input.value.trim();

  if (raw === "") {
    if (required) {
      return { value: null, error: "Este campo es obligatorio.", isEmpty: true };
    }
    return { value: null, error: null, isEmpty: true };
  }
  return { value: raw, error: null, isEmpty: false };
}

/** Pinta el estado (válido / inválido / mensaje) de un input */
function paintField(id, result) {
  const input = document.getElementById(id);
  const errorEl = document.getElementById(`err-${id}`);
  if (!input || !errorEl) return;
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
  if (!el) return;
  el.classList.toggle("has-error", errorState);
  if (value === null || value === undefined || errorState) {
    el.textContent = "–" + (suffix ? ` ${suffix}` : "");
  } else {
    el.textContent = `${formatter.format(value)}${suffix ? " " + suffix : ""}`;
  }
}

/* ---------------------------------------------------------------
   Tratamientos dinámicos (agregar / eliminar tratamientos y productos)
--------------------------------------------------------------- */
let treatments = [{ uid: 1, products: [{ uid: 1 }] }];
let nextTreatmentUid = 2;
let nextProductUid = 2;

const treatmentsContainer = document.getElementById("treatmentsContainer");
const addTreatmentBtn = document.getElementById("addTreatmentBtn");

const treatRemanenteId = (tuid) => `remanenteTrat-t${tuid}`;
const prodNameId = (tuid, puid) => `prodName-t${tuid}-p${puid}`;
const prodDosisId = (tuid, puid) => `prodDosis-t${tuid}-p${puid}`;
const prodResultId = (tuid, puid) => `prodResult-t${tuid}-p${puid}`;

const removeIconSvg = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16"></path>
      <path d="M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"></path>
      <path d="M6.5 7l0.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7"></path>
      <path d="M10 11v6M14 11v6"></path>
    </svg>`;

function renderTreatments() {
  // Guarda los valores ya ingresados antes de reconstruir el HTML, para no
  // perderlos al agregar/eliminar un tratamiento o un producto.
  const saved = {};
  treatments.forEach((t) => {
    const remInput = document.getElementById(treatRemanenteId(t.uid));
    if (remInput) saved[treatRemanenteId(t.uid)] = remInput.value;
    t.products.forEach((p) => {
      const nameInput = document.getElementById(prodNameId(t.uid, p.uid));
      const dosisInput = document.getElementById(prodDosisId(t.uid, p.uid));
      if (nameInput) saved[prodNameId(t.uid, p.uid)] = nameInput.value;
      if (dosisInput) saved[prodDosisId(t.uid, p.uid)] = dosisInput.value;
    });
  });

  treatmentsContainer.innerHTML = treatments
    .map((t, tIndex) => {
      const canRemoveTreatment = treatments.length > 1;
      const canAddProduct = t.products.length < MAX_PRODUCTS_PER_TREATMENT;

      const productsHtml = t.products
        .map((p, pIndex) => {
          const canRemoveProduct = t.products.length > 1;
          return `
            <div class="product-row" data-tuid="${t.uid}" data-puid="${p.uid}">
              <span class="product-row__label">${pIndex + 1}</span>
              <div class="field">
                <input type="text" id="${prodNameId(t.uid, p.uid)}" placeholder="Ej: Flumioxazin" maxlength="60" required />
                <span class="field__error" id="err-${prodNameId(t.uid, p.uid)}"></span>
              </div>
              <div class="field">
                <input type="number" id="${prodDosisId(t.uid, p.uid)}" step="0.001" min="${PRODUCT_DOSIS_RULE.min}" max="${PRODUCT_DOSIS_RULE.max}" placeholder="Ej: 0,4" required />
                <span class="field__error" id="err-${prodDosisId(t.uid, p.uid)}"></span>
              </div>
              <output class="computed" id="${prodResultId(t.uid, p.uid)}">–</output>
              <button
                type="button"
                class="remove-sample-btn"
                data-remove-product-tuid="${t.uid}"
                data-remove-product-puid="${p.uid}"
                ${canRemoveProduct ? "" : "disabled"}
                aria-label="Eliminar producto ${pIndex + 1}"
                title="Eliminar producto"
              >${removeIconSvg}</button>
            </div>`;
        })
        .join("");

      return `
        <div class="treatment-block" data-tuid="${t.uid}">
          <div class="treatment-block__header">
            <h3>Tratamiento ${tIndex + 1}</h3>
            <button
              type="button"
              class="remove-treatment-btn"
              data-remove-treatment-uid="${t.uid}"
              ${canRemoveTreatment ? "" : "disabled"}
              aria-label="Eliminar tratamiento ${tIndex + 1}"
              title="Eliminar tratamiento"
            >${removeIconSvg}</button>
          </div>

          <div class="products-head">
            <span aria-hidden="true"></span>
            <span>Producto</span>
            <span>Dosis (kg o L/ha)</span>
            <span>Dosis / carga</span>
            <span aria-hidden="true"></span>
          </div>
          <div class="products-rows">${productsHtml}</div>

          <button type="button" class="add-sample-btn add-product-btn" data-add-product-tuid="${t.uid}" ${canAddProduct ? "" : "hidden"}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
            Agregar producto
          </button>

          <div class="field field--solo treatment-block__remanente">
            <label for="${treatRemanenteId(t.uid)}">Remanente (L)</label>
            <input type="number" id="${treatRemanenteId(t.uid)}" step="0.01" min="${TREATMENT_REMANENTE_RULE.min}" max="${TREATMENT_REMANENTE_RULE.max}" value="0" required />
            <span class="field__error" id="err-${treatRemanenteId(t.uid)}"></span>
          </div>
        </div>`;
    })
    .join("");

  // Restaura los valores guardados en los inputs recién creados
  Object.keys(saved).forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = saved[id];
  });

  addTreatmentBtn.hidden = treatments.length >= MAX_TREATMENTS;
}

addTreatmentBtn.addEventListener("click", () => {
  if (treatments.length >= MAX_TREATMENTS) return;
  const newUid = nextTreatmentUid++;
  treatments.push({ uid: newUid, products: [{ uid: nextProductUid++ }] });
  renderTreatments();
  recalculate();
  saveState();
});

treatmentsContainer.addEventListener("click", (event) => {
  const removeTreatmentBtn = event.target.closest("[data-remove-treatment-uid]");
  if (removeTreatmentBtn) {
    if (removeTreatmentBtn.disabled || treatments.length <= 1) return;
    const uid = Number(removeTreatmentBtn.dataset.removeTreatmentUid);
    treatments = treatments.filter((t) => t.uid !== uid);
    renderTreatments();
    recalculate();
    saveState();
    return;
  }

  const addProductBtn = event.target.closest("[data-add-product-tuid]");
  if (addProductBtn) {
    const tuid = Number(addProductBtn.dataset.addProductTuid);
    const treatment = treatments.find((t) => t.uid === tuid);
    if (treatment && treatment.products.length < MAX_PRODUCTS_PER_TREATMENT) {
      treatment.products.push({ uid: nextProductUid++ });
      renderTreatments();
      recalculate();
      saveState();
    }
    return;
  }

  const removeProductBtn = event.target.closest("[data-remove-product-tuid]");
  if (removeProductBtn) {
    if (removeProductBtn.disabled) return;
    const tuid = Number(removeProductBtn.dataset.removeProductTuid);
    const puid = Number(removeProductBtn.dataset.removeProductPuid);
    const treatment = treatments.find((t) => t.uid === tuid);
    if (treatment && treatment.products.length > 1) {
      treatment.products = treatment.products.filter((p) => p.uid !== puid);
      renderTreatments();
      recalculate();
      saveState();
    }
  }
});

/* ---------------------------------------------------------------
   Persistencia local (localStorage): recuerda todo lo ingresado en el
   formulario, incluida la estructura de tratamientos/productos, aunque
   se cierre la app, se apague el dispositivo o se use offline.
--------------------------------------------------------------- */
const STORAGE_KEY = "dosiscalc-form-state-v1";

function saveState() {
  try {
    const values = {};
    form.querySelectorAll("input[id]").forEach((input) => {
      values[input.id] = input.value;
    });

    const state = {
      treatmentsStructure: treatments.map((t) => ({
        uid: t.uid,
        products: t.products.map((p) => p.uid),
      })),
      nextTreatmentUid,
      nextProductUid,
      values,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* localStorage no disponible (modo privado, cuota llena, etc.):
       los datos no se recordarán, pero la calculadora sigue funcionando. */
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function restoreState() {
  const state = loadState();

  if (state && Array.isArray(state.treatmentsStructure) && state.treatmentsStructure.length > 0) {
    treatments = state.treatmentsStructure.map((t) => ({
      uid: t.uid,
      products: (t.products || []).map((puid) => ({ uid: puid })),
    }));

    const maxTreatmentUid = treatments.reduce((max, t) => Math.max(max, t.uid), 0);
    const maxProductUid = treatments.reduce(
      (max, t) => Math.max(max, ...t.products.map((p) => p.uid), 0),
      0
    );
    nextTreatmentUid = Math.max(state.nextTreatmentUid || 0, maxTreatmentUid + 1);
    nextProductUid = Math.max(state.nextProductUid || 0, maxProductUid + 1);
  }

  renderTreatments();

  if (state && state.values) {
    Object.keys(state.values).forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = state.values[id];
    });
  }
}

/* ---------------------------------------------------------------
   Diálogo de confirmación (reutilizable para todos los botones
   "Limpiar sección" / "Limpiar todo")
--------------------------------------------------------------- */
const confirmOverlay = document.getElementById("confirmDialogOverlay");
const confirmTitleEl = document.getElementById("confirmDialogTitle");
const confirmMessageEl = document.getElementById("confirmDialogMessage");
const confirmCancelBtn = document.getElementById("confirmDialogCancel");
const confirmConfirmBtn = document.getElementById("confirmDialogConfirm");
const confirmCloseBtn = document.getElementById("confirmDialogClose");

let pendingConfirmAction = null;
let confirmCloseTimer = null;

function openConfirmDialog({ title = "Confirmar limpieza", message, onConfirm }) {
  clearTimeout(confirmCloseTimer);
  confirmTitleEl.textContent = title;
  confirmMessageEl.textContent = message;
  pendingConfirmAction = onConfirm;
  confirmOverlay.hidden = false;
  // Deja pintar el estado "hidden -> visible" antes de animar la entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => confirmOverlay.classList.add("is-open"));
  });
  confirmConfirmBtn.focus();
}

function closeConfirmDialog() {
  confirmOverlay.classList.remove("is-open");
  pendingConfirmAction = null;
  confirmCloseTimer = setTimeout(() => {
    confirmOverlay.hidden = true;
  }, 180);
}

confirmCancelBtn.addEventListener("click", closeConfirmDialog);
confirmCloseBtn.addEventListener("click", closeConfirmDialog);
confirmOverlay.addEventListener("click", (event) => {
  if (event.target === confirmOverlay) closeConfirmDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmOverlay.hidden) closeConfirmDialog();
});
confirmConfirmBtn.addEventListener("click", () => {
  const action = pendingConfirmAction;
  closeConfirmDialog();
  if (action) action();
});

/* ---------------------------------------------------------------
   Botones "Limpiar sección" / "Limpiar todo"
--------------------------------------------------------------- */
const CLEAR_SCOPE_FIELD_IDS = {
  calibracion: ["vol-1", "vol-2", "vol-3", "anchoBoquilla", "avanceMs"],
  preparacion: ["areaEnsayo", "remanente", "caldoPreparar"],
};

const CLEAR_SCOPE_MESSAGES = {
  calibracion: "¿Limpiar los campos de calibración de boquilla, ancho y velocidad?",
  preparacion: "¿Limpiar los campos de área de ensayo y caldo?",
  tratamientos: "¿Eliminar todos los tratamientos y productos ingresados?",
  todo: "¿Limpiar todo el formulario? Se perderán todos los valores ingresados.",
};

function clearFieldsByIds(ids) {
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = id === "remanente" ? "0.8" : "";
    input.classList.remove("is-valid", "is-invalid");
    const errorEl = document.getElementById(`err-${id}`);
    if (errorEl) errorEl.textContent = "";
  });
}

function resetTreatments() {
  treatments = [{ uid: 1, products: [{ uid: 1 }] }];
  nextTreatmentUid = 2;
  nextProductUid = 2;
  // Vacía el contenedor antes de reconstruir: así renderTreatments() no
  // encuentra inputs previos con los mismos ids (p.ej. remanenteTrat-t1) y
  // no arrastra sus valores antiguos al tratamiento recién reseteado.
  treatmentsContainer.innerHTML = "";
  renderTreatments();
}

function clearScope(scope) {
  if (scope === "tratamientos") {
    resetTreatments();
  } else if (scope === "todo") {
    clearFieldsByIds(CLEAR_SCOPE_FIELD_IDS.calibracion);
    clearFieldsByIds(CLEAR_SCOPE_FIELD_IDS.preparacion);
    resetTreatments();
  } else if (CLEAR_SCOPE_FIELD_IDS[scope]) {
    clearFieldsByIds(CLEAR_SCOPE_FIELD_IDS[scope]);
  }
  recalculate();
  saveState();
}

document.querySelectorAll("[data-clear-scope]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const scope = btn.dataset.clearScope;
    openConfirmDialog({
      message: CLEAR_SCOPE_MESSAGES[scope] || "¿Limpiar estos campos?",
      onConfirm: () => clearScope(scope),
    });
  });
});

/* ---------------------------------------------------------------
   Cálculo principal
--------------------------------------------------------------- */
function recalculate() {
  // --- 1. Calibración de boquilla (3 muestras fijas) ---
  const sampleResults = SAMPLE_IDS.map((id, index) => {
    const r = readField(id, SAMPLE_RULE);
    paintField(id, r);
    return { index, ...r };
  });

  const gastoBySample = sampleResults.map((r) => (r.error ? null : r.value * 3));
  sampleResults.forEach((r, i) => {
    paintComputed(`gasto-${i + 1}`, gastoBySample[i], nf2, "L/min", !!r.error);
  });

  const gastoValid = gastoBySample.every((v) => v !== null);
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

  // --- 8. Tratamientos (productos y dosis) ---
  let treatmentsValid = true;

  const treatmentRows = treatments.map((t, tIndex) => {
    const remResult = readField(treatRemanenteId(t.uid), TREATMENT_REMANENTE_RULE);
    paintField(treatRemanenteId(t.uid), remResult);
    if (remResult.error) treatmentsValid = false;

    const productResults = t.products.map((p) => {
      const nameResult = readTextField(prodNameId(t.uid, p.uid), { required: true });
      paintField(prodNameId(t.uid, p.uid), nameResult);

      const dosisResult = readField(prodDosisId(t.uid, p.uid), PRODUCT_DOSIS_RULE);
      paintField(prodDosisId(t.uid, p.uid), dosisResult);

      if (nameResult.error || dosisResult.error) treatmentsValid = false;

      const productoOk = !dosisResult.error;
      const producto = productoOk ? dosisResult.value : null;
      const dosisCargaOk = productoOk && caldoEfectivoOk && mojamientoOk && mojamiento > 0;
      const dosisCarga = dosisCargaOk ? (producto * caldoEfectivo * 1000) / mojamiento : null;

      paintComputed(prodResultId(t.uid, p.uid), dosisCarga, nf2, "g/mL", !dosisCargaOk);

      return {
        name: !nameResult.error && !nameResult.isEmpty ? nameResult.value : "–",
        dosis: !dosisResult.error ? nf2.format(dosisResult.value) : "–",
        dosisCarga: dosisCargaOk ? nf2.format(dosisCarga) : "–",
      };
    });

    return {
      label: String(tIndex + 1),
      productos: productResults.map((p) => p.name).join(" + "),
      dosis: productResults.map((p) => p.dosis).join(" + "),
      dosisCarga: productResults.map((p) => p.dosisCarga).join(" + "),
      remanente: !remResult.error && !remResult.isEmpty ? nf2.format(remResult.value) : "–",
    };
  });

  // --- Snapshot para el informe PDF ---
  const anyFieldError =
    Object.values(results).some((r) => r.error) ||
    sampleResults.some((r) => r.error) ||
    !treatmentsValid;
  formIsValid = !anyFieldError;

  lastReportState = {
    fileName: `DosisCalc-informe-${pdfFileStamp()}.pdf`,
    samples: sampleResults.map((r, i) => ({
      label: `Muestra ${i + 1}`,
      volume: r.error ? "–" : pdfTrim(nf2.format(r.value)),
      gasto: gastoBySample[i] !== null ? pdfTrim(nf2.format(gastoBySample[i])) : "–",
    })),
    gastoPromedio: { value: gastoProm !== null ? pdfTrim(nf2.format(gastoProm)) : "–", unit: "L/min" },
    // Columna izquierda del PDF: ítem 1 (muestras, dibujado aparte) + ítem 2
    leftColumnSections: [
      {
        title: "2. Ancho de boquilla",
        rows: [{ label: "Ancho de boquilla", value: pdfTrim(nf2.format(ancho ?? 0)), unit: "m" }],
      },
    ],
    // Columna derecha del PDF: ítems 3 (Velocidad, dibujado aparte), 4 y 5
    rightColumnSections: [
      {
        title: "4. Área de ensayo",
        rows: [{ label: "Área de ensayo", value: pdfTrim(nf2.format(area ?? 0)), unit: "m²" }],
      },
      {
        title: "5. Caldo",
        rows: [
          { label: "Caldo necesario", value: caldoCalc !== null ? pdfTrim(nf2.format(caldoCalc)) : "–", unit: "L" },
          { label: "Remanente mochila", value: pdfTrim(nf2.format(remanente)), unit: "L" },
          { label: "Caldo total", value: caldoTotal !== null ? pdfTrim(nf2.format(caldoTotal)) : "–", unit: "L" },
          { label: "Caldo a preparar", value: caldoEfectivo !== null ? pdfTrim(nf2.format(caldoEfectivo)) : "–", unit: "L" },
        ],
      },
    ],
    // Ítem 3 (Velocidad): avance (ingresado + calculado, en una sola fila
    // como las muestras), seguido de cobertura y mojamiento. Se dibuja al
    // inicio de la columna derecha del PDF.
    velocidad: {
      title: "3. Velocidad",
      avance: {
        label: "Avance",
        msValue: avanceOk ? `${pdfTrim(nf2.format(avanceMs))} m/s` : "–",
        mminValue: avanceMmin !== null ? `${pdfTrim(nf1.format(avanceMmin))} m/min` : "–",
      },
      cobertura: { label: "Cobertura", value: m2min !== null ? pdfTrim(nf2.format(m2min)) : "–", unit: "m²/min" },
      mojamiento: { label: "Mojamiento", value: mojamiento !== null ? pdfTrim(nf0.format(mojamiento)) : "–", unit: "L/ha" },
    },
    // Ítem 6, a todo el ancho: un tratamiento por fila, con productos, dosis
    // y dosis por carga en notación de suma literal (no calculada).
    treatments: treatmentRows.map((t) => ({
      ...t,
      dosis: pdfTrim(t.dosis),
      dosisCarga: pdfTrim(t.dosisCarga),
      remanente: pdfTrim(t.remanente),
    })),
  };
}

// Recalcular y guardar al instante con cada tecla / cambio
form.addEventListener("input", () => {
  recalculate();
  saveState();
});
form.addEventListener("submit", (e) => e.preventDefault());

// Restaura lo guardado (o usa los valores por defecto del HTML) y calcula
restoreState();
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

pdfBtn.addEventListener("click", async () => {
  if (!formIsValid || !lastReportState) {
    showPdfMessage(
      "Completa correctamente todos los campos requeridos antes de generar el PDF.",
      true
    );
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
    await window.DosisPDF.generate(lastReportState);
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
