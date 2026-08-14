export type Mode = "classic" | "ease" | "freeze" | "pulse" | "zoom";

// A boomerang "mode" is a speed curve applied across the trimmed segment.
// "classic" is flat (factor 1 everywhere); "ease" slows down at the edges
// and speeds up through the middle for a slow-fast-slow swoosh. These zones
// are the single source of truth for three things that must never drift
// apart: the live in-browser preview, the ffmpeg export (which splits the
// segment into these same zones and encodes each one), and the
// total-duration readout shown to the user.
export const EASE_ZONES = [
  { from: 0, to: 0.3, factor: 0.55 },
  { from: 0.3, to: 0.7, factor: 1.9 },
  { from: 0.7, to: 1, factor: 0.55 },
] as const;

/** Speed multiplier at a given position (0..1) through the trimmed segment. */
export function zoneFactorAt(mode: Mode, fraction: number): number {
  if (mode !== "ease") return 1;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const zone = EASE_ZONES.find((z) => clamped >= z.from && clamped <= z.to);
  return (zone ?? EASE_ZONES[EASE_ZONES.length - 1]).factor;
}

/** How long the forward pass through the segment takes to play back, in seconds. */
export function forwardDuration(mode: Mode, speed: number, segmentDuration: number): number {
  if (mode !== "ease") return segmentDuration / speed;
  return EASE_ZONES.reduce((total, zone) => {
    const zoneInputDuration = (zone.to - zone.from) * segmentDuration;
    return total + zoneInputDuration / (speed * zone.factor);
  }, 0);
}

// How long a mode holds on a frozen frame at each extreme (peak and start)
// before continuing, in seconds. Only "freeze" uses this.
export const FREEZE_HOLD_SECONDS = 0.35;

// How far back "pulse" pulls from the peak before snapping forward again,
// as a fraction of the segment (0 = start, 1 = peak). 0.55 means it rewinds
// about 45% of the way back before the second forward push.
export const PULSE_PULLBACK = 0.55;

/**
 * Total time one full loop (every leg of the mode's motion, plus any holds)
 * takes to play, in seconds. "zoom" reuses classic's timing exactly — it's
 * a purely visual effect layered on the reverse leg, not a timing change.
 * "freeze" and "pulse" always run at a fixed effective speed of 1 (the app
 * only exposes the speed picker for "classic"), matching how the caller is
 * expected to resolve speed before reaching here.
 */
export function perLoopDuration(mode: Mode, speed: number, segmentDuration: number): number {
  if (mode === "classic" || mode === "ease" || mode === "zoom") {
    const timingMode = mode === "ease" ? "ease" : "classic";
    return forwardDuration(timingMode, speed, segmentDuration) * 2;
  }
  if (mode === "freeze") {
    return forwardDuration("classic", speed, segmentDuration) * 2 + FREEZE_HOLD_SECONDS * 2;
  }
  // pulse: forward(0->1) + pull back(1->PULLBACK) + forward again(PULLBACK->1) + full reverse(1->0)
  const full = forwardDuration("classic", speed, segmentDuration);
  const pullbackSpan = (1 - PULSE_PULLBACK) * full;
  return full + pullbackSpan + pullbackSpan + full;
}

/** Total output duration of the finished boomerang (all loops). */
export function totalBoomerangDuration(
  mode: Mode,
  speed: number,
  segmentDuration: number,
  loops: number,
): number {
  return perLoopDuration(mode, speed, segmentDuration) * loops;
}

const ABSOLUTE_MAX_LOOPS = 40;

// Fixed targets per classic speed — both normal and slow motion land around
// 8s total (16s overshot what felt right for slow motion). Modes without a
// speed picker (ease/freeze/pulse/zoom) share this same default target
// since they have no slow/fast axis either.
const CLASSIC_TARGET_SECONDS: Record<number, number> = { 0.5: 8, 1: 8 };
const DEFAULT_TARGET_SECONDS = 8;

/**
 * The one loop count a given mode/speed/segment combination should use —
 * no user choice anymore, derived to land at or under a fixed target total
 * duration (mirroring how Instagram's boomerang has no loop-count picker
 * either, just "normal" vs "slow motion"). Floored rather than rounded to
 * the nearest loop count: the target is a ceiling, not a midpoint, so the
 * total should never run past it — only the segment/speed changes how
 * close to it a whole number of loops can land, never an extra loop that
 * overshoots.
 */
export function deriveLoops(mode: Mode, speed: number, segmentDuration: number): number {
  const perLoop = perLoopDuration(mode, speed, segmentDuration);
  if (perLoop <= 0) return 1;
  const target = mode === "classic" ? (CLASSIC_TARGET_SECONDS[speed] ?? DEFAULT_TARGET_SECONDS) : DEFAULT_TARGET_SECONDS;
  return Math.min(ABSOLUTE_MAX_LOOPS, Math.max(1, Math.floor(target / perLoop)));
}

export interface Leg {
  /** Start position, as a fraction (0..1) of the trimmed segment. */
  from: number;
  /** End position, as a fraction (0..1) of the trimmed segment. */
  to: number;
  /** Whether this leg's playback rate follows EASE_ZONES (only "ease" uses this). */
  eased: boolean;
  /** Seconds to hold on the current frame before this leg starts. */
  holdBefore: number;
}

const LEGS_BY_MODE: Record<Mode, Leg[]> = {
  classic: [
    { from: 0, to: 1, eased: false, holdBefore: 0 },
    { from: 1, to: 0, eased: false, holdBefore: 0 },
  ],
  ease: [
    { from: 0, to: 1, eased: true, holdBefore: 0 },
    { from: 1, to: 0, eased: true, holdBefore: 0 },
  ],
  zoom: [
    { from: 0, to: 1, eased: false, holdBefore: 0 },
    { from: 1, to: 0, eased: false, holdBefore: 0 },
  ],
  freeze: [
    { from: 0, to: 1, eased: false, holdBefore: FREEZE_HOLD_SECONDS },
    { from: 1, to: 0, eased: false, holdBefore: FREEZE_HOLD_SECONDS },
  ],
  pulse: [
    { from: 0, to: 1, eased: false, holdBefore: 0 },
    { from: 1, to: PULSE_PULLBACK, eased: false, holdBefore: 0 },
    { from: PULSE_PULLBACK, to: 1, eased: false, holdBefore: 0 },
    { from: 1, to: 0, eased: false, holdBefore: 0 },
  ],
};

/** The sequence of legs a mode's live preview (and export) walks through per loop. */
export function legsFor(mode: Mode): readonly Leg[] {
  return LEGS_BY_MODE[mode];
}

/** Which leg index (if any) gets the zoom-in visual treatment. Only "zoom" has one. */
export function zoomLegIndex(mode: Mode): number | null {
  return mode === "zoom" ? 1 : null;
}
