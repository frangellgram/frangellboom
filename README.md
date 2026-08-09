# frangellboom 🪃

Crea boomerangs desde tus propios videos, en la calidad que quieras — sin el límite de 720p de Instagram.

## Cómo funciona

1. Importá un video (grabado con la cámara de tu dispositivo).
2. Elegí el tramo que querés convertir en boomerang (hasta 2 segundos).
3. Ajustá velocidad, modo (clásico o "ease"), repeticiones y calidad de salida — con vista previa en vivo.
4. Exportá y descargá tu boomerang.

Todo el procesamiento de video pasa **dentro de tu navegador** (usando [ffmpeg.wasm](https://ffmpegwasm.netlify.app/)): tu video nunca se sube a ningún servidor. La app no tiene backend.

Es instalable como PWA en Android y iPhone, y funciona sin conexión una vez instalada.

## Desarrollo

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

Genera un sitio 100% estático en `dist/` — se puede servir desde cualquier hosting estático (ver `deploy/nginx.conf.example` para una configuración de referencia con headers de seguridad).

## Stack

React · TypeScript · Vite · ffmpeg.wasm

## Licencia

[MIT](./LICENSE)
