import { useCallback, useEffect, useRef, useState } from "react";

interface VideoRecorderProps {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

const RECORD_SECONDS = 2;
// A little longer than the visible 2s countdown — MediaRecorder.stop() has
// its own flush latency, and undershooting here would leave the source clip
// a few frames short of what extractPreviewClip/createBoomerang expect to
// hard-trim down to exactly 2s later.
const RECORD_MS = RECORD_SECONDS * 1000 + 150;

// No audio codecs in this list: the rest of the pipeline strips audio with
// `-an` on every ffmpeg pass anyway, so we never request a microphone track.
// iOS Safari (14.3+) records straight to H.264 mp4; everything else that
// implements MediaRecorder does vp8/vp9 webm, which ffmpeg.wasm demuxes
// fine as an input.
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function extForMimeType(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? ".mp4" : ".webm";
}

type RecorderState = "requesting" | "live" | "recording" | "denied" | "unsupported";

export function VideoRecorder({ onCapture, onCancel }: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const [state, setState] = useState<RecorderState>("requesting");
  const [elapsed, setElapsed] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Attaches whatever stream we currently have to the <video> element the
  // moment it exists. A plain useEffect keyed on the stream isn't enough
  // here: the <video> only mounts once `state` flips to "live", which
  // happens *after* getUserMedia resolves, so by the time that promise
  // callback ran, videoRef.current was still null and the preview stayed
  // black (recording itself still worked fine — MediaRecorder reads the
  // stream directly, never through this element).
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.muted = true;
      node.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Rear camera by default (this records subjects, not selfies), but
    // "ideal" (not "exact") so devices without one — a laptop webcam during
    // testing — still get a stream instead of a hard failure. Resolution
    // and frame rate are also just "ideal": getUserMedia otherwise falls
    // back to a modest default (e.g. 30fps) far below what the phone's own
    // camera app can do, so ask for the phone's best without hard-requiring
    // 4K60 on devices/browsers that can't deliver it.
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }
        setState("live");
      })
      .catch(() => {
        if (!cancelled) setState("denied");
      });

    return () => {
      cancelled = true;
      stopStream();
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    };
  }, [stopStream]);

  const handleRecord = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (!stream || !mimeType) {
      setState("unsupported");
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stopStream();
      if (cancelledRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File([blob], `grabacion${extForMimeType(mimeType)}`, { type: mimeType });
      onCapture(file);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setElapsed(0);

    const startedAt = performance.now();
    const tick = () => {
      const secs = Math.min((performance.now() - startedAt) / 1000, RECORD_SECONDS);
      setElapsed(secs);
      if (secs < RECORD_SECONDS) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    stopTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, RECORD_MS);
  }, [stopStream, onCapture]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopStream();
    }
    onCancel();
  }, [stopStream, onCancel]);

  const pct = Math.min(100, Math.round((elapsed / RECORD_SECONDS) * 100));

  return (
    <div className="recorder">
      <div className="recorder__panel">
        <button type="button" className="recorder__close" onClick={handleCancel} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" className="recorder__close-icon" fill="none" aria-hidden="true">
            <path
              d="M6,6 L18,18 M18,6 L6,18"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {(state === "live" || state === "recording") && (
          <>
            <video ref={attachVideo} className="recorder__video" autoPlay muted playsInline />
            <div className="recorder__timer">
              <div className="recorder__timer-bar">
                <div className="recorder__timer-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="recorder__timer-label">{elapsed.toFixed(1)}s / {RECORD_SECONDS.toFixed(1)}s</span>
            </div>
            <button
              type="button"
              className={`recorder__record-btn${state === "recording" ? " recorder__record-btn--active" : ""}`}
              onClick={handleRecord}
              disabled={state === "recording"}
              aria-label="Grabar"
            />
          </>
        )}

        {state === "requesting" && <p className="recorder__message">Pidiendo acceso a la cámara…</p>}

        {state === "denied" && (
          <p className="recorder__message">
            No pudimos acceder a la cámara. Revisá los permisos de cámara para esta app en los ajustes de tu
            dispositivo, o elegí un archivo en su lugar.
          </p>
        )}

        {state === "unsupported" && (
          <p className="recorder__message">Tu navegador no puede grabar video acá. Elegí un archivo en su lugar.</p>
        )}
      </div>
    </div>
  );
}
