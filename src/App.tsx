import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoUploader } from "./components/VideoUploader";
import { BoomerangMark } from "./components/BoomerangMark";
import { VideoTrimmer } from "./components/VideoTrimmer";
import { BoomerangPreview } from "./components/BoomerangPreview";
import { BoomerangControls } from "./components/BoomerangControls";
import { ProcessingOverlay } from "./components/ProcessingOverlay";
import { ResultView } from "./components/ResultView";
import { getFFmpeg } from "./lib/ffmpegClient";
import { createBoomerang, type Resolution, type Speed, type Mode } from "./lib/boomerang";
import { extractPreviewClip } from "./lib/previewClip";
import { probeFrameRate } from "./lib/probeVideo";
import { totalBoomerangDuration, deriveLoops } from "./lib/boomerangMath";
import "./App.css";

// Below this, 0.5x slow motion starts looking choppy instead of smooth —
// setpts just stretches existing frames over more time, it doesn't
// interpolate new ones in between, so a 30fps source ends up playing back
// at an effective ~15fps once slowed down.
const CHOPPY_SLOWMO_FPS_THRESHOLD = 48;

type Step = "upload" | "trim" | "adjust" | "processing" | "result";

const DEFAULT_SEGMENT = 2;
const MIN_SEGMENT = 0.5;
const MAX_SEGMENT = 2;

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
  const [sourceFps, setSourceFps] = useState<number | null>(null);
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

  const handleSelect = useCallback((selected: File) => {
    setError(null);
    setFile(selected);
    setDuration(0);
    setStart(0);
    setSegmentDuration(DEFAULT_SEGMENT);
    setSourceFps(null);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(selected);
    });
    setPreviewClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStep("trim");

    // Fire-and-forget: reads the source fps in the background while the
    // person trims, so it's already known by the time they'd reach the
    // 0.5x speed picker on the adjust screen.
    getFFmpeg()
      .then((ffmpeg) => probeFrameRate(ffmpeg, selected))
      .then(setSourceFps)
      .catch(() => {});
  }, []);

  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setResultBlob(null);
    setError(null);
    setProgress(0);
    setSourceFps(null);
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
    try {
      setProcessingLabel("Cargando el motor de video…");
      const ffmpeg = await getFFmpeg();
      setProcessingLabel("Creando tu boomerang…");
      const blob = await createBoomerang(ffmpeg, file, {
        start,
        duration: clampedSegmentDuration,
        loops,
        resolution,
        speed: effectiveSpeed,
        mode,
        onProgress: setProgress,
      });
      setResultBlob(blob);
      setStep("result");
    } catch (err) {
      console.error(err);
      setError("No se pudo procesar el video. Probá con un clip más corto o recargá la página.");
      setStep("adjust");
    }
  }, [file, start, clampedSegmentDuration, loops, resolution, effectiveSpeed, mode]);

  const handleGoToAdjust = useCallback(async () => {
    if (!file) return;
    setPreparingPreview(true);
    setError(null);
    try {
      const ffmpeg = await getFFmpeg();
      const clip = await extractPreviewClip(ffmpeg, file, {
        start,
        duration: clampedSegmentDuration,
      });
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

  const showFpsNote =
    mode === "classic" && effectiveSpeed === 0.5 && sourceFps !== null && sourceFps < CHOPPY_SLOWMO_FPS_THRESHOLD;

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

              <div
                className={`controls__collapse${showFpsNote ? " controls__collapse--open" : ""}`}
              >
                <div className="controls__collapse-inner">
                  {sourceFps !== null && (
                    <p className="fps-note">
                      Este video se grabó a {Math.round(sourceFps)}fps, a 0.5x el movimiento puede verse algo
                      entrecortado en vez de un slow motion fluido. Para un resultado más suave, grabá a 60fps o
                      más.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="app__overlay">
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
