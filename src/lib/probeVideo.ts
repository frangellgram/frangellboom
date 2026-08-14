import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { extOf } from "./boomerang";

// ffmpeg's own stream-info line for the input (printed to its log before it
// errors out below, since we never give it an output file) looks like:
// "Stream #0:0(und): Video: h264 ..., 640x360 [...], 29.97 fps, 30 tbr, ...".
const FPS_PATTERN = /(\d+(?:\.\d+)?)\s*fps/;

/**
 * Reads the source video's frame rate without actually decoding/transcoding
 * it — running `-i <file>` with no output makes ffmpeg print the stream
 * info to its log and then exit with an error, which is all we need. Used
 * to warn when 0.5x slow motion would look choppy on a low-fps source (see
 * the frame-rate note on the adjust screen).
 */
export async function probeFrameRate(ffmpeg: FFmpeg, inputFile: File): Promise<number | null> {
  const inputName = "probe" + extOf(inputFile.name);
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

  let fps: number | null = null;
  const handleLog = ({ message }: { message: string }) => {
    if (fps !== null) return;
    const match = FPS_PATTERN.exec(message);
    if (match) fps = parseFloat(match[1]);
  };
  ffmpeg.on("log", handleLog);

  try {
    await ffmpeg.exec(["-i", inputName]).catch(() => {});
  } finally {
    ffmpeg.off("log", handleLog);
    await ffmpeg.deleteFile(inputName).catch(() => {});
  }

  return fps;
}
