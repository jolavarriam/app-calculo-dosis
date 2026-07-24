// Mensaje simple de estado según conexión
const statusEl = document.getElementById("status");

function updateOnlineStatus() {
  statusEl.textContent = navigator.onLine
    ? "✅ Conectado a internet"
    : "📴 Sin conexión (funcionando offline)";
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// Registro del Service Worker (necesario para que sea instalable / offline)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then((reg) => console.log("Service Worker registrado:", reg.scope))
      .catch((err) => console.error("Error al registrar Service Worker:", err));
  });
}

// Botón de instalación personalizado (Android / Chrome / Edge)
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
  console.log("PWA instalada correctamente");
  installBtn.hidden = true;
});
