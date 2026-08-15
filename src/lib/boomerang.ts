import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";
import { legsFor, totalBoomerangDuration, zoneFactorAt, zoomLegIndex, type Mode } from "./boomerangMath";

export type Resolution = "original" | "1440" | "1080" | "720" | "480";
export type Speed = 0.5 | 1 | 1.5 | 2;
export type { Mode };

// Output is always encoded at a fixed 60fps regardless of the source's own
// framerate. Two reasons: it gives slow-motion zones (factor < 1, see
// `wantsBlend` below) enough frame slots to actually receive the blended
// in-between frames instead of just duplicating source frames — and 60fps
// divides evenly (or close to it) into the 60/90/120Hz refresh rates modern
// phone screens actually use, where a plain 30fps file can visibly judder
// even though the file itself is perfectly valid.
const OUTPUT_FPS = 60;
const FRAME_DURATION = 1 / OUTPUT_FPS;

// "zoom" mode's constant punch-in, applied only to the leg `zoomLegIndex`
// points at. Matches how the previous ffmpeg pipeline did it: scale up then
// crop back down to the same output size, so it's a same-resolution digital
// zoom rather than something that needs extra source detail held in memory.
const ZOOM_FACTOR = 1.15;

// mediabunny's built-in `Quality('very-high')` sizes its bitrate purely off
// resolution, with no awareness of framerate. We always encode at a fixed
// OUTPUT_FPS (60), so a preset calibrated for a lower assumed fps ends up
// splitting the same bit budget across twice as many frames — every frame
// gets less data than it needs, which reads as blur rather than an outright
// error. Computing bitrate ourselves from actual output pixels *and* actual
// output fps (a plain bits-per-pixel-per-frame target, tuned to look
// comparable to the old ffmpeg pipeline's crf 16) keeps quality consistent
// regardless of how fast we're encoding.
// Pushed well past a normal "high quality" target (~0.12) specifically to
// compensate for Safari's documented habit of under-delivering relative to
// whatever bitrate it's asked for — asking for more is the direct lever
// available from the JS side. File size and encode time both grow with
// this; for a several-second clip that trade is worth it for real sharpness.
const BITS_PER_PIXEL_PER_FRAME = 0.6;

function targetBitrate(width: number, height: number): number {
  return Math.round(width * height * OUTPUT_FPS * BITS_PER_PIXEL_PER_FRAME);
}

// Explicit low quantizer (== ffmpeg's old crf 16) passed alongside the
// bitrate above, not instead of it. WebCodecs lets an encoder be given both
// a target bitrate *and* a per-frame quantizer hint — whichever one Safari's
// encoder actually honors (its bitrate handling is the documented unreliable
// one), the quantizer is a second, more hardware-native lever pointed at the
// same "encode this sharp" goal.
const QUANTIZER = 10;

const RESOLUTION_HEIGHTS: Partial<Record<Resolution, number>> = {
  "1440": 1440,
  "1080": 1080,
  "720": 720,
  "480": 480,
};

function evenize(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

function targetDimensions(resolution: Resolution, srcWidth: number, srcHeight: number) {
  const targetHeight = RESOLUTION_HEIGHTS[resolution];
  if (!targetHeight) return { width: evenize(srcWidth), height: evenize(srcHeight) };
  const targetWidth = Math.round(srcWidth * (targetHeight / srcHeight));
  return { width: evenize(targetWidth), height: evenize(targetHeight) };
}

export interface BoomerangOptions {
  start: number;
  duration: number;
  loops: number;
  resolution: Resolution;
  speed: Speed;
  mode: Mode;
  onProgress?: (fraction: number) => void;
}

interface DecodedFrame {
  /** Seconds since the start of the trimmed segment (0..duration). */
  t: number;
  bitmap: ImageBitmap;
}

/** Binary-search `frames` (sorted by `t`) for the pair bracketing `t`, plus the blend weight toward the later one. */
function bracket(frames: DecodedFrame[], t: number): { a: DecodedFrame; b: DecodedFrame | null; alpha: number } {
  if (frames.length === 1 || t <= frames[0].t) return { a: frames[0], b: null, alpha: 0 };
  const last = frames[frames.length - 1];
  if (t >= last.t) return { a: last, b: null, alpha: 0 };

  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  return { a, b, alpha: span > 0 ? (t - a.t) / span : 0 };
}

export async function createBoomerang(
  inputFile: File,
  { start, duration, loops, resolution, speed, mode, onProgress }: BoomerangOptions,
): Promise<Blob> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(inputFile) });
  const frames: DecodedFrame[] = [];

  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      throw new Error("No se pudo leer el video (formato no soportado).");
    }

    const srcWidth = await track.getDisplayWidth();
    const srcHeight = await track.getDisplayHeight();
    const { width: outWidth, height: outHeight } = targetDimensions(resolution, srcWidth, srcHeight);
    const zoomWidth = Math.round(outWidth * ZOOM_FACTOR);
    const zoomHeight = Math.round(outHeight * ZOOM_FACTOR);
    const zoomOffsetX = (zoomWidth - outWidth) / 2;
    const zoomOffsetY = (zoomHeight - outHeight) / 2;

    // Decode every source frame in the trimmed range exactly once, drawing
    // each straight into an offscreen canvas at the final output size and
    // keeping only the resulting bitmap. This is what lets "reverse" and
    // "loop" be free afterwards — random access into an array instead of a
    // second decode pass or a real `reverse` filter — and it's also why
    // memory stays bounded: we never hold more than one full-resolution
    // frame at a time, only the (much cheaper) already-scaled bitmaps.
    // `prefer-software` steers WebCodecs away from the platform's hardware
    // codec block (Apple's VideoToolbox on iOS/macOS) and onto a real
    // software codec implementation instead. Hardware blocks are built for
    // fast, "good enough" throughput (camera apps, video calls), not for
    // honoring an exact requested bitrate — that mismatch is almost
    // certainly why 2K came out blurry even with a generous bitrate above.
    // Software decode/encode is slower, but here that's the right trade:
    // a boomerang export finishing in a few extra seconds beats one that
    // finishes fast but looks bad, or one whose hardware path is hitting
    // whatever internal limit is crashing 4K outright.
    const codecPreference = { hardwareAcceleration: "prefer-software" as const };
    const sink = new VideoSampleSink(track, codecPreference);
    const scratch = new OffscreenCanvas(outWidth, outHeight);
    const scratchCtx = scratch.getContext("2d")!;
    for await (const sample of sink.samples(start, start + duration)) {
      scratchCtx.clearRect(0, 0, outWidth, outHeight);
      sample.drawWithFit(scratchCtx, { fit: "cover" });
      frames.push({ t: sample.timestamp - start, bitmap: await createImageBitmap(scratch) });
      sample.close();
    }
    if (frames.length === 0) {
      throw new Error("El tramo elegido no tiene frames de video.");
    }

    // Safari's WebCodecs H.264 encoder has a known, documented bug where it
    // silently ignores the requested bitrate (w3c/webcodecs#430) — no matter
    // how generous a number we compute, it can still encode low-quality.
    // HEVC is ~40% more bit-efficient than AVC to begin with, and is the
    // codec Apple's own hardware is built around, so it's worth trying as
    // the primary target — with AVC as a fallback for browsers (notably
    // Android Chrome) that don't ship an HEVC *encoder* at all.
    const quality = new Quality({ bitrate: targetBitrate(outWidth, outHeight), quantizer: QUANTIZER });
    const codec = (await canEncodeVideo("hevc", { width: outWidth, height: outHeight, quality })) ? "hevc" : "avc";

    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const videoSource = new VideoSampleSource({ codec, quality, ...codecPreference });
    output.addVideoTrack(videoSource);
    await output.start();

    const canvas = new OffscreenCanvas(outWidth, outHeight);
    const ctx = canvas.getContext("2d")!;
    const legs = legsFor(mode);
    const zoomIndex = zoomLegIndex(mode);
    const expectedTotal = totalBoomerangDuration(mode, speed, duration, loops) || 1;
    let outputTime = 0;

    const emit = async (fraction: number, isZoom: boolean, blend: boolean) => {
      const { a, b, alpha } = bracket(frames, fraction * duration);
      const useBlend = blend && b !== null;
      ctx.clearRect(0, 0, outWidth, outHeight);
      if (isZoom) {
        ctx.drawImage(a.bitmap, -zoomOffsetX, -zoomOffsetY, zoomWidth, zoomHeight);
        if (useBlend) {
          ctx.globalAlpha = alpha;
          ctx.drawImage(b!.bitmap, -zoomOffsetX, -zoomOffsetY, zoomWidth, zoomHeight);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.drawImage(a.bitmap, 0, 0);
        if (useBlend) {
          ctx.globalAlpha = alpha;
          ctx.drawImage(b!.bitmap, 0, 0);
          ctx.globalAlpha = 1;
        }
      }

      const sample = new VideoSample(canvas, { timestamp: outputTime, duration: FRAME_DURATION });
      await videoSource.add(sample);
      sample.close();
      outputTime += FRAME_DURATION;
      onProgress?.(Math.min(outputTime / expectedTotal, 0.99));
    };

    for (let loop = 0; loop < Math.max(loops, 1); loop++) {
      for (let legIndex = 0; legIndex < legs.length; legIndex++) {
        const leg = legs[legIndex];
        const dir = leg.to >= leg.from ? 1 : -1;
        const isZoomLeg = zoomIndex === legIndex;

        for (let held = 0; held < leg.holdBefore; held += FRAME_DURATION) {
          await emit(leg.from, isZoomLeg, false);
        }

        for (
          let fraction = leg.from;
          dir > 0 ? fraction < leg.to : fraction > leg.to;

        ) {
          const rate = (leg.eased ? zoneFactorAt(mode, fraction) : 1) * speed;
          await emit(fraction, isZoomLeg, rate < 1);
          // `rate` is a speed multiplier (fraction-per-real-second, roughly
          // matching how useBoomerangPreview paces a <video> element's
          // currentTime), not a fraction-per-output-frame step — it has to
          // be scaled down by the segment's own duration to get how much of
          // the 0..1 leg span one output frame actually covers, otherwise
          // every leg finishes in a duration-independent, speed-only amount
          // of time (confirmed by testing: without the `/ duration`, a
          // classic 0.5x/2s-segment boomerang came out 4s instead of 8s).
          fraction += (FRAME_DURATION * rate * dir) / duration;
        }
      }
    }

    await output.finalize();
    onProgress?.(1);

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("La exportación no produjo ningún archivo.");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    for (const f of frames) f.bitmap.close();
    input.dispose();
  }
}

export function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : ".mp4";
}
