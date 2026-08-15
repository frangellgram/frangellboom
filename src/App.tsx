import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoUploader } from "./components/VideoUploader";
import { BoomerangMark } from "./components/BoomerangMark";
import { VideoTrimmer } from "./components/VideoTrimmer";
import { BoomerangPreview } from "./components/BoomerangPreview";
import { BoomerangControls } from "./components/BoomerangControls";
import { ProcessingOverlay } from "./components/ProcessingOverlay";
import { ResultView } from "./components/ResultView";
import { getFFmpeg, withFFmpeg } from "./lib/ffmpegClient";
import { createBoomerang, type Resolution, type Speed, type Mode } from "./lib/boomerang";
import { extractPreviewClip } from "./lib/previewClip";
import { totalBoomerangDuration, deriveLoops } from "./lib/boomerangMath";
import { requestWakeLock, releaseWakeLock } from "./lib/wakeLock";
import "./App.css";

type Step = "upload" | "trim" | "adjust" | "processing" | "result";

const DEFAULT_SEGMENT = 2;
const MIN_SEGMENT = 0.5;
const MAX_SEGMENT = 2;
// How long the processing overlay fades out before "result" takes over —
// without this the overlay (a full-screen blurred backdrop + spinner) just
// vanished the instant the export finished, which read as an abrupt cut
// even though the result screen itself fades in underneath it.
const OVERLAY_LEAVE_MS = 280;

function App() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [segmentDuration, setSegmentDuration] = useState(DEFAULT_SEGMENT);
  const [speed, setSpeed] = useState<Speed>(1);
  const [mode, setMode] = useState<Mode>("classic");
  const [resolution, setResolution] = useState<Resolution>("original");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState("Preparando…");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [previewClipUrl, setPreviewClipUrl] = useState<string | null>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [overlayLeaving, setOverlayLeaving] = useState(false);
  const ffmpegPreload = useRef(false);

  // Kick off the (large) ffmpeg-core download as soon as the user lands,
  // so it's likely ready by the time they hit "Crear boomerang".
  useEffect(() => {
    if (ffmpegPreload.current) return;
    ffmpegPreload.current = true;
    getFFmpeg().catch(() => {
      /* swallow — a real error will surface again when processing starts */
    });
  }, []);

  // The wake lock is auto-released whenever the tab loses visibility (the
  // spec requires this) — re-request it if the person switches back while
  // an export is still running, instead of leaving the screen free to lock
  // again for the rest of that export.
  useEffect(() => {
    if (step !== "processing") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [step]);

  const handleSelect = useCallback((selected: File) => {
    setError(null);
    setFile(selected);
    setDuration(0);
    setStart(0);
    setSegmentDuration(DEFAULT_SEGMENT);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(selected);
    });
    setPreviewClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStep("trim");
  }, []);

  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setResultBlob(null);
    setError(null);
    setProgress(0);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const maxSegmentDuration = duration > 0 ? Math.min(duration, MAX_SEGMENT) : DEFAULT_SEGMENT;
  const clampedSegmentDuration = Math.min(segmentDuration, maxSegmentDuration);

  // Only "classic" exposes a speed picker — every other mode has a fixed,
  // baked-in motion (see legsFor in boomerangMath), so its effective speed
  // is always 1 regardless of whatever the (hidden) speed picker last held.
  const effectiveSpeed: Speed = mode === "classic" ? speed : 1;

  // No more a user-editable loop count: it's derived to land close to a
  // fixed target total duration per mode/speed (Instagram-style — normal
  // vs. slow motion each have one "right" length, not a range to pick from).
  const loops = useMemo(
    () => deriveLoops(mode, effectiveSpeed, clampedSegmentDuration),
    [mode, effectiveSpeed, clampedSegmentDuration],
  );

  const handleCreate = useCallback(async () => {
    if (!file) return;
    setStep("processing");
    setProgress(0);
    setError(null);
    setOverlayLeaving(false);
    requestWakeLock();
    try {
      setProcessingLabel("Creando tu boomerang…");
      const blob = await createBoomerang(file, {
        start,
        duration: clampedSegmentDuration,
        loops,
        resolution,
        speed: effectiveSpeed,
        mode,
        onProgress: setProgress,
      });
      setResultBlob(blob);
      setOverlayLeaving(true);
      await new Promise((resolve) => window.setTimeout(resolve, OVERLAY_LEAVE_MS));
      setStep("result");
    } catch (err) {
      console.error(err);
      setError("No se pudo procesar el video. Probá con un clip más corto o recargá la página.");
      setStep("adjust");
    } finally {
      releaseWakeLock();
    }
  }, [file, start, clampedSegmentDuration, loops, resolution, effectiveSpeed, mode]);

  const handleGoToAdjust = useCallback(async () => {
    if (!file) return;
    setPreparingPreview(true);
    setError(null);
    try {
      const clip = await withFFmpeg((ffmpeg) =>
        extractPreviewClip(ffmpeg, file, {
          start,
          duration: clampedSegmentDuration,
        }),
      );
      setPreviewClipUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(clip);
      });
    } catch (err) {
      console.error(err);
      // Non-fatal: BoomerangPreview falls back to scrubbing the original
      // file directly, just less smoothly.
    } finally {
      setPreparingPreview(false);
      setStep("adjust");
    }
  }, [file, start, clampedSegmentDuration]);

  const totalDuration = useMemo(
    () => totalBoomerangDuration(mode, effectiveSpeed, clampedSegmentDuration, loops),
    [mode, effectiveSpeed, clampedSegmentDuration, loops],
  );

  return (
    <div className="app">
      <header className="app__header">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="app__logo" width="36" height="36" />
        <div>
          <h1 className="app__title">frangellboom</h1>
          <p className="app__tagline">boomerangs en alta calidad, a tu manera</p>
        </div>
      </header>

      <main className="app__main">
        {step === "upload" && (
          <div className="upload-screen">
            <VideoUploader onSelect={handleSelect} error={error} />
          </div>
        )}

        {step === "trim" && videoUrl && (
          <div className="trim-screen">
            <div className="editor">
              <VideoTrimmer
                videoUrl={videoUrl}
                duration={duration}
                start={start}
                segmentDuration={clampedSegmentDuration}
                onStartChange={setStart}
                onDurationChange={setDuration}
              />

              <div className="controls controls--single">
                <div className="controls__row">
                  <label className="controls__label" htmlFor="segment-duration">
                    <span>Duración del video para boomerang</span>
                    <span className="controls__value">{clampedSegmentDuration.toFixed(1)}s</span>
                  </label>
                  <input
                    id="segment-duration"
                    type="range"
                    min={MIN_SEGMENT}
                    max={Math.max(maxSegmentDuration, MIN_SEGMENT)}
                    step={0.1}
                    value={clampedSegmentDuration}
                    onChange={(e) => setSegmentDuration(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="editor__actions">
                <button type="button" className="btn btn--ghost" onClick={handleReset}>
                  Volver atrás
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleGoToAdjust}
                  disabled={duration === 0 || preparingPreview}
                >
                  {preparingPreview ? "Preparando…" : "Siguiente →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {(step === "adjust" || step === "processing") && videoUrl && (
          <div className="adjust-screen">
            <div className="editor">
              <BoomerangPreview
                videoUrl={previewClipUrl ?? videoUrl}
                start={previewClipUrl ? 0 : start}
                duration={clampedSegmentDuration}
                speed={effectiveSpeed}
                mode={mode}
              />

              <p className="total-duration">
                Tramo: <strong>{clampedSegmentDuration.toFixed(1)}s</strong> · Duración total:{" "}
                <strong>{totalDuration.toFixed(1)}s</strong>
              </p>

              <BoomerangControls
                speed={speed}
                onSpeedChange={setSpeed}
                mode={mode}
                onModeChange={setMode}
                resolution={resolution}
                onResolutionChange={setResolution}
              />

              {error && <p className="app__error">{error}</p>}

              <div className="editor__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setStep("trim")}>
                  ← Recortar
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleCreate}
                  disabled={step === "processing"}
                >
                  <BoomerangMark className="btn__mark" />
                  Crear boomerang
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className={`app__overlay${overlayLeaving ? " app__overlay--leaving" : ""}`}>
            <ProcessingOverlay progress={progress} label={processingLabel} />
          </div>
        )}

        {step === "result" && resultBlob && (
          <div className="result-screen">
            <ResultView blob={resultBlob} onReset={handleReset} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
