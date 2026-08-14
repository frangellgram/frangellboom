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

// ffmpeg.wasm runs on a single worker and isn't safe to drive with
// overlapping calls — e.g. the fps probe firing in the background while the
// person taps through to the trim/adjust screens could land mid-export and
// corrupt both (wrong fps read, or the export itself failing with "no se
// pudo procesar el video"). Every ffmpeg-touching call in the app should go
// through this instead of calling getFFmpeg().exec directly, so they're
// forced to run one at a time in the order they were requested.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Tears down the current ffmpeg instance (if any) so the next getFFmpeg()
 * call boots a completely fresh one. Needed because ffmpeg.wasm's linear
 * memory only ever grows across calls, never shrinks back — after enough
 * exports in one session (chunked reverses especially add up) it can trip a
 * fatal "RuntimeError: memory access out of bounds". That error permanently
 * poisons the instance: every call after it fails the same way, which is
 * exactly what "funciona las primeras veces, después siempre falla" looks
 * like from the outside. There's no in-place recovery from it — only a
 * fresh instance works again.
 */
export async function resetFFmpeg(): Promise<void> {
  const current = instance;
  instance = null;
  loading = null;
  if (current) {
    try {
      current.terminate();
    } catch {
      /* already dead — that's fine, we're discarding it anyway */
    }
  }
}

export function withFFmpeg<T>(task: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const ffmpeg = await getFFmpeg();
    try {
      return await task(ffmpeg);
    } catch (err) {
      // A fatal WASM trap leaves the instance unusable for every call after
      // it too — reset now so whatever the app retries next (or the very
      // next queued task) gets a clean instance instead of inheriting the
      // broken one.
      await resetFFmpeg();
      throw err;
    }
  });
  // Keep the queue alive even if this task fails — otherwise one failed
  // export would wedge every ffmpeg call after it for the rest of the
  // session. The real success/failure still propagates to the caller via
  // `run`, this is only to unblock the *next* queued task.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
