export type Mode = "classic" | "ease";

// A boomerang "mode" is just a speed curve applied across the trimmed
// segment. "classic" is flat (factor 1 everywhere); "ease" slows down at
// the edges and speeds up through the middle for a slow-fast-slow swoosh.
// These zones are the single source of truth for three things that must
// never drift apart: the live in-browser preview, the ffmpeg export (which
// splits the segment into these same zones and encodes each one), and the
// total-duration readout shown to the user.
export const EASE_ZONES = [
  { from: 0, to: 0.3, factor: 0.55 },
  { from: 0.3, to: 0.7, factor: 1.9 },
  { from: 0.7, to: 1, factor: 0.55 },
] as const;

/** Speed multiplier at a given position (0..1) through the trimmed segment. */
export function zoneFactorAt(mode: Mode, fraction: number): number {
  if (mode === "classic") return 1;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const zone = EASE_ZONES.find((z) => clamped >= z.from && clamped <= z.to);
  return (zone ?? EASE_ZONES[EASE_ZONES.length - 1]).factor;
}

/** How long the forward pass through the segment takes to play back, in seconds. */
export function forwardDuration(mode: Mode, speed: number, segmentDuration: number): number {
  if (mode === "classic") return segmentDuration / speed;
  return EASE_ZONES.reduce((total, zone) => {
    const zoneInputDuration = (zone.to - zone.from) * segmentDuration;
    return total + zoneInputDuration / (speed * zone.factor);
  }, 0);
}

/** Total output duration of the finished boomerang (forward + reverse, × loops). */
export function totalBoomerangDuration(
  mode: Mode,
  speed: number,
  segmentDuration: number,
  loops: number,
): number {
  return forwardDuration(mode, speed, segmentDuration) * 2 * loops;
}
