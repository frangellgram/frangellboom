import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { extOf } from "./boomerang";

export interface PreviewClipParams {
  start: number;
  duration: number;
}

/**
 * Cuts a tiny, low-res, all-keyframe copy of the trimmed segment so the live
 * preview can scrub it smoothly. Seeking inside the original upload is what
 * was causing the stutter: each seek has to decode forward from the nearest
 * keyframe, and phone-recorded video typically keyframes only every second
 * or two. `-g 1` makes every single frame a keyframe, so any seek is free —
 * exactly what constant back-and-forth scrubbing needs.
 */
export async function extractPreviewClip(
  ffmpeg: FFmpeg,
  inputFile: File,
  { start, duration }: PreviewClipParams,
): Promise<Blob> {
  const inputName = "preview_src" + extOf(inputFile.name);
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

  try {
    await ffmpeg.exec([
      "-ss", start.toFixed(3),
      "-t", duration.toFixed(3),
      "-i", inputName,
      "-vf", "scale=-2:360",
      "-an",
      "-g", "1",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "30",
      "-pix_fmt", "yuv420p",
      "preview_scrub.mp4",
    ]);
    const data = await ffmpeg.readFile("preview_scrub.mp4");
    return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile("preview_scrub.mp4").catch(() => {});
  }
}
