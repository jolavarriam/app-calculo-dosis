# Hello World PWA

Una PWA (Progressive Web App) mínima hecha con HTML + CSS + JavaScript puro,
instalable en Android e iOS, sin backend ni base de datos.

## Estructura del proyecto

```
├── index.html          # Página principal
├── styles.css          # Estilos
├── app.js              # Lógica: registro del service worker + botón de instalación
├── manifest.json        # Web App Manifest (nombre, iconos, colores)
├── service-worker.js    # Cache offline
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

## Cómo subirlo a tu repositorio de GitHub

Dentro de la carpeta de tu repositorio local:

```bash
git add .
git commit -m "Hello world PWA"
git push origin main
```

## Cómo publicarlo gratis con GitHub Pages

1. Ve a tu repositorio en GitHub → **Settings** → **Pages**.
2. En "Build and deployment" → **Source**, selecciona **Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`.
4. Guarda. En un par de minutos tu sitio estará disponible en:
   `https://<tu-usuario>.github.io/<nombre-del-repo>/`

⚠️ **Importante:** las PWA requieren **HTTPS** para funcionar (registrar el
service worker e instalar la app). GitHub Pages ya sirve todo por HTTPS, así
que no necesitas configurar nada extra.

## Cómo instalarla en el celular

### Android (Chrome)
1. Abre la URL de tu sitio en Chrome.
2. Debería aparecer un botón "Instalar app" (el que agregamos en `app.js`),
   o puedes usar el menú ⋮ → **"Instalar app"** / **"Añadir a pantalla de inicio"**.

### iOS (Safari)
iOS no dispara el evento `beforeinstallprompt`, así que la instalación es manual:
1. Abre la URL en **Safari** (no funciona desde Chrome en iOS).
2. Toca el botón de **Compartir** (el cuadrado con la flecha hacia arriba).
3. Selecciona **"Añadir a pantalla de inicio"**.

## Notas

- No hay build tools ni dependencias: es HTML/CSS/JS plano, se puede editar
  directamente y probar abriendo `index.html`, aunque para probar el
  Service Worker e instalación necesitas servirlo por HTTP(S)
  (por ejemplo con `npx serve` o la extensión "Live Server" de VS Code,
  o directamente subiéndolo a GitHub Pages).
- Los iconos son placeholders simples generados automáticamente
  (un círculo con una "H"). Puedes reemplazarlos por tu propio logo,
  respetando los mismos nombres de archivo y tamaños (192x192, 512x512,
  y 180x180 para `apple-touch-icon.png`).
- El `service-worker.js` cachea los archivos estáticos para que la app
  funcione sin conexión después de la primera visita.
