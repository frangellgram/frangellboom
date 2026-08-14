// Keeps the screen from dimming/locking during export — without it, a long
// ffmpeg pass (chunked reverses at 2K/Original especially) can run right
// into the phone's auto-lock, and iOS throttles/backgrounds a locked tab
// hard enough to stall or kill the export outright.
let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (!("wakeLock" in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
  } catch {
    // Not fatal — e.g. the tab isn't visible/focused at the moment of the
    // request. The export just proceeds without the screen staying awake.
  }
}

export async function releaseWakeLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (current) await current.release().catch(() => {});
}
