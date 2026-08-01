# DosisCalc

Una PWA (Progressive Web App) con Vanilla JavaScript y 
un diseño elegante claro/oscuro, compatible con navegadores web e 
instalable en Android e iOS con funcionamiento 100% offline. 
Es un formulario de cálculo que permite estimar la dosis de aplicación 
(calibración de boquilla, mojamiento, caldo y dosis final), 
con recálculo y validaciones instantáneas.
Finalmente permite generar un informe en PDF en tamaño carta
con los datos ingresados y calculados.

## Estructura del proyecto

```
├── index.html              # Página principal (formulario)
├── styles.css              # Estilos (tema claro "alta gama" / oscuro "midnight minimal")
├── app.js                  # Cálculo, validación, tema, PWA, botón de PDF
├── pdf-report.js           # Genera el informe PDF con jsPDF
├── manifest.json           # Web App Manifest (nombre, iconos, colores)
├── service-worker.js       # Cache offline (app shell + jsPDF + fuentes)
├── vendor/
│   ├── jspdf.umd.min.js    # jsPDF vendorizado "Librería de PDF"
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

## Cálculo de dosis (resumen del modelo)

El formulario permite en un paso a paso el cálculo de dosis de aplicación:

1. **Calibración de boquilla** — se ingresa el volumen recolectado (L) en 20
   segundos, siempre en **3 muestras fijas**; cada una se convierte a gasto
   (L/min) y se promedian entre las 3.
2. **Ancho de boquilla (m)**.
3. **Avance** — velocidad en m/s, convertida a m/min.
4. **Cobertura (m²/min)** — ancho de boquilla × avance.
5. **Mojamiento (L/ha)** — gasto promedio × 10.000 ÷ cobertura.
6. **Área de ensayo (m²)**.
7. **Caldo** — caldo necesario (mojamiento × área), remanente de mochila
   (0,8 L por defecto) y caldo total; además, el caldo a preparar
   (redondeado a la capacidad real del estanque/mochila), que es el valor
   sobre el que se calcula la dosis de cada producto.
8. **Tratamientos** — se puede agregar **uno o más tratamientos** (hasta 30).
   Cada tratamiento puede tener **hasta 3 productos**, cada uno con su
   nombre y su dosis (kg o L por hectárea); la dosis por carga de caldo de
   cada producto se calcula automáticamente (producto × caldo a preparar ×
   1000 ÷ mojamiento). Cada tratamiento tiene además un campo de
   **remanente (L)** que solo se usa para el informe, no afecta ningún
   cálculo.

Todos los campos se validan en tiempo real (rangos referenciales, no
normativos) y el recálculo ocurre al instante con cada cambio en el
formulario.

## Persistencia de datos

Todo lo ingresado en el formulario (muestras, campos globales y la lista
completa de tratamientos/productos) se guarda automáticamente en el
`localStorage` del navegador o de la app instalada. Los datos se recuerdan
aunque se cierre la pestaña, se reinicie la app o se apague el dispositivo,
tanto en modo online como offline. Si el navegador bloquea `localStorage`
(por ejemplo en una ventana privada), la calculadora sigue funcionando con
normalidad, simplemente no recordará los valores la próxima vez.

## Informe en PDF: ítem 8 (Tratamientos)

En el PDF, el ítem 8 se muestra como una tabla a todo el ancho, con una
fila por tratamiento. Si un tratamiento tiene más de un producto, los
nombres, la dosis y la dosis por carga se muestran en **notación de suma
literal** (no se suman matemáticamente), por ejemplo:

```
Tratamiento 1   Flumioxazin + Rimsulfuron   0,40 + 0,20   2,16 + 1,08   0,30
```

El remanente de cada tratamiento se muestra como un único número.

## Librería de PDF: jsPDF

Para la generación de PDF se usa [jsPDF](https://github.com/parallax/jsPDF) (MIT license) para generar
el informe.citamente simulando el dispositivo offline.

## Cómo instalarla en el celular

### Android (Chrome)
1. Abre la URL de tu sitio en Chrome.
2. Debería aparecer un botón "Instalar app", o usa el menú ⋮ →
   **"Instalar app"** / **"Añadir a pantalla de inicio"**.
3. Al generar el PDF desde la app instalada, Chrome lo guarda automáticamente
   en la carpeta **Descargas** del teléfono, igual que cualquier descarga.

### iOS (Safari)
1. Abre la URL en **Safari** (no funciona desde Chrome en iOS).
2. Toca **Compartir** → **"Añadir a pantalla de inicio"**.
3. Al generar el PDF, iOS **no permite guardarlo automáticamente y en
   silencio** en una carpeta (restricción del sistema, no de esta app): se
   abre el PDF o aparece la hoja para compartir/guardar, y ahí eliges
   **"Guardar en Archivos"**. Es un paso más que en Android, pero el archivo
   final es el mismo PDF.

## Notas

- Los rangos de validación de cada campo son referenciales (para detectar
  valores fuera de lo razonable o mal ingresados), no límites normativos.
- Cada vez que cambies archivos cacheados, sube el número de versión de
  `CACHE_NAME` en `service-worker.js` para forzar la actualización en los
  dispositivos que ya tengan la app instalada.
