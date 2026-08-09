import { FFmpeg } from "@ffmpeg/ffmpeg";

// Served from our own origin (see vite.config.ts static-copy of @ffmpeg/core)
// instead of a CDN, so the app has zero third-party runtime dependencies and
// keeps working fully offline as a PWA.
//
// These must be fully-qualified (scheme + host), not root-relative: the
// ffmpeg worker resolves them with a dynamic import(), and a "/ffmpeg/..."
// specifier fails to resolve from inside a worker's module scope.
const CORE_JS_URL = new URL(`${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`, window.location.href).href;
const CORE_WASM_URL = new URL(`${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`, window.location.href).href;

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export function getFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  const ffmpeg = new FFmpeg();
  if (onLog) {
    ffmpeg.on("log", ({ message }) => onLog(message));
  }

  loading = (async () => {
    await ffmpeg.load({ coreURL: CORE_JS_URL, wasmURL: CORE_WASM_URL });
    instance = ffmpeg;
    return ffmpeg;
  })();

  return loading;
}
