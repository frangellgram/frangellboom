import { useEffect, useRef } from "react";
import { zoneFactorAt, type Mode } from "../lib/boomerangMath";

interface Params {
  /** Identifies the underlying video resource (e.g. its src/blob URL), purely
   *  so the loop restarts when the source changes even if start/duration/etc
   *  happen to stay numerically the same. */
  sourceKey: string;
  start: number;
  duration: number;
  speed: number;
  mode: Mode;
  playing: boolean;
}

/**
 * Drives a <video> element's currentTime back and forth by hand via
 * requestAnimationFrame to preview the real forward+reverse+speed boomerang
 * motion instantly, with zero ffmpeg processing. Native <video> has no
 * reverse playback, so this is the standard trick: keep the element paused
 * and manually seek every frame.
 *
 * Seeks are paced to the video's own "seeked" event instead of firing one
 * every animation frame — issuing a new seek before the previous one has
 * actually resolved is what causes visible stutter, especially on slower
 * devices.
 */
export function useBoomerangPreview(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  { sourceKey, start, duration, speed, mode, playing }: Params,
) {
  const directionRef = useRef<1 | -1>(1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing || duration <= 0) return;

    directionRef.current = 1;
    let lastTs: number | null = null;
    let rafId: number;
    let seeking = false;
    let cancelled = false;

    const onSeeked = () => {
      seeking = false;
    };
    video.addEventListener("seeked", onSeeked);

    // iOS Safari never decodes a frame for a <video> that hasn't played yet,
    // so seeking it by hand (below) leaves it black. A silent play/pause
    // "primes" the decoder first.
    video.play().then(() => video.pause()).catch(() => {});
    video.currentTime = start;

    const tick = (ts: number) => {
      if (cancelled) return;
      if (lastTs == null) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      if (!seeking) {
        const fraction = (video.currentTime - start) / duration;
        const rate = speed * zoneFactorAt(mode, fraction);

        let next = video.currentTime + dt * rate * directionRef.current;
        if (next >= start + duration) {
          next = start + duration;
          directionRef.current = -1;
        } else if (next <= start) {
          next = start;
          directionRef.current = 1;
        }
        seeking = true;
        video.currentTime = next;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [videoRef, sourceKey, start, duration, speed, mode, playing]);
}
