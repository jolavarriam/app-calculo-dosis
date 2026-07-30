# DosisCalc

Una PWA (Progressive Web App) hecha con HTML + CSS + JavaScript puro,
instalable en Android e iOS, sin backend ni base de datos. Calcula la dosis
de aplicación (calibración de boquilla, mojamiento, caldo y dosis final) con
recálculo instantáneo, validación de errores en cada campo, tema claro/oscuro
con memoria, y generación de un informe en PDF — todo funcionando sin
conexión una vez instalada.

## Estructura del proyecto

```
├── index.html              # Página principal (formulario)
├── styles.css              # Estilos (tema claro "alta gama" / oscuro "midnight minimal")
├── app.js                  # Cálculo, validación, tema, PWA, botón de PDF
├── pdf-report.js           # Genera el informe PDF con jsPDF
├── manifest.json           # Web App Manifest (nombre, iconos, colores)
├── service-worker.js       # Cache offline (app shell + jsPDF + fuentes)
├── vendor/
│   ├── jspdf.umd.min.js    # jsPDF vendorizado (ver "Librería de PDF" abajo)
│   └── jspdf.LICENSE.txt   # Licencia MIT de jsPDF
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

## Cálculo de dosis (resumen del modelo)

La calculadora replica, paso a paso, el modelo del Excel original:

1. **Calibración de boquilla** — se ingresa el volumen recolectado (L) en 20
   segundos por cada muestra (hasta 20 muestras); cada una se convierte a
   gasto (L/min) y se promedian.
2. **Ancho de boquilla (m)**.
3. **Avance** — velocidad en m/s, convertida a m/min.
4. **Cobertura (m²/min)** — ancho de boquilla × avance.
5. **Mojamiento (L/ha)** — gasto promedio × 10.000 ÷ cobertura.
6. **Área de ensayo (m²)**.
7. **Caldo** — caldo necesario (mojamiento × área), remanente de mochila
   (0,8 L por defecto) y caldo total; además, el caldo a preparar
   (redondeado a la capacidad real del estanque/mochila), que es el valor
   sobre el que se calcula la dosis final.
8. **Dosis final** — producto por hectárea × caldo a preparar × 1000 ÷
   mojamiento, expresada en g (o mL) por carga de caldo.

Todos los campos se validan en tiempo real (rangos referenciales, no
normativos) y el recálculo ocurre al instante con cada cambio en el
formulario.

## Librería de PDF: jsPDF

Se usa [jsPDF](https://github.com/parallax/jsPDF) (MIT license) para generar
el informe. Se eligió porque:

- Es pura JavaScript, sin dependencias, y tiene un build UMD de un solo
  archivo fácil de auto-alojar (`vendor/jspdf.umd.min.js`) — no depende de un
  CDN, lo cual es clave para que funcione **sin conexión**.
- Su API de dibujo (texto, rectángulos, líneas) es suficiente para un reporte
  tabulado con buen control de diseño, sin necesitar plugins extra como
  `jspdf-autotable` (el reporte dibuja las "tablas" a mano en `pdf-report.js`,
  lo que también evita pesar más el bundle offline).
- Alternativas como `pdf-lib` también son excelentes y MIT, pero su API es de
  más bajo nivel para este caso de uso (formulario → reporte con texto).

El archivo `vendor/jspdf.umd.min.js` (~410 KB) queda cacheado por el
`service-worker.js` la primera vez que se abre la app con conexión. Desde ahí
en adelante, el botón **"Generar PDF"** funciona incluso sin internet — se
probó explícitamente simulando el dispositivo offline.

El informe se genera en tamaño carta, con las muestras de calibración e
ítems 2-6 en dos columnas, e ítems 7-8 y el resultado final a todo el ancho
debajo. Si el contenido no cupiera en una sola página (por ejemplo, con
muchas muestras), continúa automáticamente en una página nueva.

## Cómo subirlo a tu repositorio de GitHub

Dentro de la carpeta de tu repositorio local:

```bash
git add .
git commit -m "DosisCalc"
git push origin main
```

## Cómo publicarlo gratis con GitHub Pages

1. Ve a tu repositorio en GitHub → **Settings** → **Pages**.
2. En "Build and deployment" → **Source**, selecciona **Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`.
4. Guarda. En un par de minutos tu sitio estará disponible en:
   `https://<tu-usuario>.github.io/<nombre-del-repo>/`

⚠️ **Importante:** las PWA requieren **HTTPS** para funcionar (registrar el
service worker e instalar la app). GitHub Pages ya sirve todo por HTTPS.

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

## Tema claro/oscuro

El botón ☀/☾ en la esquina superior cambia entre el tema claro ("alta
gama") y oscuro ("midnight minimal"). La elección se guarda en
`localStorage` del navegador/dispositivo y se recuerda en la próxima visita.
Si nunca se elige manualmente, la app sigue el tema del sistema operativo,
incluso en vivo si el sistema cambia de tema mientras la app está abierta.

## Notas

- No hay build tools: es HTML/CSS/JS plano. Para probar el Service Worker,
  el tema o el botón de PDF necesitas servirlo por HTTP(S) (por ejemplo
  `npx serve`, la extensión "Live Server" de VS Code, o subiéndolo a GitHub
  Pages) — abrir `index.html` como archivo local (`file://`) no activa el
  Service Worker.
- Los rangos de validación de cada campo son referenciales (para detectar
  valores fuera de lo razonable o mal ingresados), no límites normativos.
- Cada vez que cambies archivos cacheados, sube el número de versión de
  `CACHE_NAME` en `service-worker.js` para forzar la actualización en los
  dispositivos que ya tengan la app instalada.
