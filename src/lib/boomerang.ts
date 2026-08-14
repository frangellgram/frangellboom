import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { EASE_ZONES, forwardDuration, type Mode } from "./boomerangMath";

export type Resolution = "original" | "1440" | "1080" | "720" | "480";
export type Speed = 0.5 | 1 | 1.5 | 2;
export type { Mode };

// Only the two highest tiers are big enough to risk the reverse pass (see
// below) blowing past iOS Safari's per-tab memory ceiling, so only those
// get the extra chunking overhead — 1080/720/480 keep the cheaper single-
// pass reverse they've always used. Value is the chunk length in seconds.
const REVERSE_CHUNK_SECONDS: Partial<Record<Resolution, number>> = {
  original: 0.3,
  "1440": 0.4,
};

export interface BoomerangOptions {
  start: number;
  duration: number;
  loops: number;
  resolution: Resolution;
  speed: Speed;
  mode: Mode;
  onProgress?: (fraction: number) => void;
}

type StepKind = "encode" | "copy";

// "encode" steps (re-encoding video) take far longer than "copy" steps
// (container-only concat/loop), so weight progress accordingly.
function progressWeights(kinds: StepKind[]): number[] {
  const raw = kinds.map((k) => (k === "encode" ? 1 : 0.15));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

export async function createBoomerang(
  ffmpeg: FFmpeg,
  inputFile: File,
  { start, duration, loops, resolution, speed, mode, onProgress }: BoomerangOptions,
): Promise<Blob> {
  const inputName = "input" + extOf(inputFile.name);
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

  const chunkSeconds = REVERSE_CHUNK_SECONDS[resolution];
  const finalSegmentDuration = forwardDuration(mode, speed, duration);
  const reverseChunkCount = chunkSeconds
    ? Math.max(1, Math.ceil(finalSegmentDuration / chunkSeconds))
    : 1;
  const reverseSteps: StepKind[] =
    reverseChunkCount > 1 ? [...Array(reverseChunkCount).fill("encode" as StepKind), "copy"] : ["encode"];

  const stepKinds: StepKind[] =
    mode === "ease"
      ? ["encode", "encode", "encode", "copy", ...reverseSteps, "copy", "copy"]
      : ["encode", ...reverseSteps, "copy", "copy"];
  const weights = progressWeights(stepKinds);

  let stepIndex = 0;
  let stepBase = 0;
  const handleProgress = ({ progress }: { progress: number }) => {
    const clamped = Math.min(Math.max(progress, 0), 1);
    onProgress?.(Math.min(stepBase + clamped * weights[stepIndex], 0.99));
  };
  ffmpeg.on("progress", handleProgress);
  const advance = () => {
    stepBase += weights[stepIndex];
    stepIndex++;
  };

  const cleanupFiles = [inputName, "segment.mp4", "reversed.mp4", "concat.txt", "pingpong.mp4", "output.mp4"];
  // Deleted eagerly as soon as each is consumed, instead of only at the end —
  // mobile browsers have much tighter WASM memory limits than desktop, and
  // keeping every intermediate file resident in MEMFS at once was pushing
  // exports over the limit and crashing the tab partway through.
  const del = (name: string) => ffmpeg.deleteFile(name).catch(() => {});

  try {
    const scaleFilter = resolution === "original" ? "" : `,scale=-2:${resolution}`;

    if (mode === "ease") {
      const zoneFiles: string[] = [];
      for (let i = 0; i < EASE_ZONES.length; i++) {
        const zone = EASE_ZONES[i];
        const zoneStart = start + zone.from * duration;
        const zoneDuration = (zone.to - zone.from) * duration;
        const factor = speed * zone.factor;
        const name = `zone${i}.mp4`;
        await ffmpeg.exec([
          "-ss", zoneStart.toFixed(3),
          "-t", zoneDuration.toFixed(3),
          "-i", inputName,
          "-vf", `setpts=(PTS-STARTPTS)/${factor}${scaleFilter}`,
          "-an",
          "-c:v", "libx264",
          "-preset", "superfast",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          name,
        ]);
        advance();
        zoneFiles.push(name);
        cleanupFiles.push(name);
      }
      cleanupFiles.push("zones.txt");
      await ffmpeg.writeFile("zones.txt", zoneFiles.map((f) => `file '${f}'`).join("\n") + "\n");
      await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "zones.txt", "-c", "copy", "segment.mp4"]);
      advance();
      await del("zones.txt");
      for (const f of zoneFiles) await del(f);
    } else {
      // Trim to the chosen segment (+ speed + optional downscale), strip
      // audio, re-encode so cut points land on real frames instead of the
      // nearest keyframe.
      await ffmpeg.exec([
        "-ss", start.toFixed(3),
        "-t", duration.toFixed(3),
        "-i", inputName,
        "-vf", `setpts=PTS/${speed}${scaleFilter}`,
        "-an",
        "-c:v", "libx264",
        "-preset", "superfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "segment.mp4",
      ]);
      advance();
    }
    await del(inputName);

    // Build the reversed copy of that same (already speed-adjusted) segment.
    // Codec settings must be explicit here too — without them ffmpeg falls
    // back to a much slower default preset for this pass.
    //
    // The `reverse` filter has to hold every decoded frame in memory before
    // it can write them out backwards. At native/2K resolution that's
    // enough raw frame data to blow past iOS Safari's per-tab memory
    // ceiling — the OS kills the tab outright when that happens, so there's
    // no error to catch, it just reloads. Splitting the segment into small
    // chunks, reversing each chunk on its own, then splicing the chunks
    // back together in *reverse chunk order* produces the exact same frame
    // order as reversing the whole thing at once (same idea as reversing a
    // deck of cards a few at a time), but peak memory only ever has to hold
    // one chunk instead of the whole segment.
    if (reverseChunkCount > 1) {
      const chunkFiles: string[] = [];
      for (let i = 0; i < reverseChunkCount; i++) {
        const chunkStart = i * chunkSeconds!;
        const chunkLength = Math.min(chunkSeconds!, finalSegmentDuration - chunkStart);
        const name = `rchunk${i}.mp4`;
        await ffmpeg.exec([
          "-ss", chunkStart.toFixed(3),
          "-t", chunkLength.toFixed(3),
          "-i", "segment.mp4",
          "-vf", "reverse",
          "-an",
          "-c:v", "libx264",
          "-preset", "superfast",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          name,
        ]);
        advance();
        chunkFiles.push(name);
        cleanupFiles.push(name);
      }
      cleanupFiles.push("reverse-chunks.txt");
      await ffmpeg.writeFile(
        "reverse-chunks.txt",
        [...chunkFiles].reverse().map((f) => `file '${f}'`).join("\n") + "\n",
      );
      await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "reverse-chunks.txt", "-c", "copy", "reversed.mp4"]);
      advance();
      await del("reverse-chunks.txt");
      for (const f of chunkFiles) await del(f);
    } else {
      await ffmpeg.exec([
        "-i", "segment.mp4",
        "-vf", "reverse",
        "-an",
        "-c:v", "libx264",
        "-preset", "superfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "reversed.mp4",
      ]);
      advance();
    }

    // Glue forward + reverse into a single ping-pong cycle.
    await ffmpeg.writeFile("concat.txt", "file 'segment.mp4'\nfile 'reversed.mp4'\n");
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "pingpong.mp4"]);
    advance();
    await del("segment.mp4");
    await del("reversed.mp4");
    await del("concat.txt");

    // Repeat the cycle without re-encoding. Built via the concat demuxer
    // (rather than -stream_loop) because ffmpeg.wasm doesn't reliably loop
    // an input stream — it silently plays it back only once.
    cleanupFiles.push("loops.txt");
    await ffmpeg.writeFile(
      "loops.txt",
      Array.from({ length: Math.max(loops, 1) }, () => "file 'pingpong.mp4'").join("\n") + "\n",
    );
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "loops.txt", "-c", "copy", "output.mp4"]);
    advance();
    await del("pingpong.mp4");
    await del("loops.txt");

    onProgress?.(1);

    // Pass the read bytes straight into the Blob — wrapping them in
    // `new Uint8Array(data)` would copy the entire output file a second
    // time, which is exactly the kind of extra peak memory that was
    // crashing the tab on iPhone right as the export finished.
    const data = await ffmpeg.readFile("output.mp4");
    return new Blob([data as BlobPart], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    for (const f of cleanupFiles) {
      await ffmpeg.deleteFile(f).catch(() => {});
    }
  }
}

export function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : ".mp4";
}
