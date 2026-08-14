import { useEffect } from "react";
import { legsFor, zoneFactorAt, zoomLegIndex, type Mode } from "../lib/boomerangMath";

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
 * requestAnimationFrame to preview the real boomerang motion instantly,
 * with zero ffmpeg processing. Native <video> has no reverse playback, so
 * this is the standard trick: keep the element paused and manually seek
 * every frame.
 *
 * Walks the mode's leg sequence (see boomerangMath.legsFor) instead of a
 * single forward/back bounce, so it can represent freeze's holds and
 * pulse's multi-leg stutter, not just classic/ease's one round trip.
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
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing || duration <= 0) return;

    const legs = legsFor(mode);
    const zoomIndex = zoomLegIndex(mode);
    let legIndex = 0;
    let fraction = legs[0].from;
    let holdRemaining = legs[0].holdBefore;
    let lastTs: number | null = null;
    let rafId: number;
    let seeking = false;
    let cancelled = false;

    const applyZoom = () => {
      video.classList.toggle("preview__video--zoom", zoomIndex !== null && legIndex === zoomIndex);
    };

    const onSeeked = () => {
      seeking = false;
    };
    video.addEventListener("seeked", onSeeked);

    // iOS Safari never decodes a frame for a <video> that hasn't played yet,
    // so seeking it by hand (below) leaves it black. A silent play/pause
    // "primes" the decoder first.
    video.play().then(() => video.pause()).catch(() => {});
    video.currentTime = start + fraction * duration;
    applyZoom();

    const tick = (ts: number) => {
      if (cancelled) return;
      if (lastTs == null) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      if (holdRemaining > 0) {
        holdRemaining -= dt;
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (!seeking) {
        const leg = legs[legIndex];
        const dir = leg.to >= leg.from ? 1 : -1;
        const rate = (leg.eased ? zoneFactorAt(mode, fraction) : 1) * speed;

        let next = fraction + dt * rate * dir;
        const reachedEnd = dir > 0 ? next >= leg.to : next <= leg.to;
        if (reachedEnd) {
          next = leg.to;
          legIndex = (legIndex + 1) % legs.length;
          holdRemaining = legs[legIndex].holdBefore;
          applyZoom();
        }
        fraction = next;
        seeking = true;
        video.currentTime = start + fraction * duration;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      video.removeEventListener("seeked", onSeeked);
      video.classList.remove("preview__video--zoom");
    };
  }, [videoRef, sourceKey, start, duration, speed, mode, playing]);
}
