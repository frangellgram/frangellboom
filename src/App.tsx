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
import { totalBoomerangDuration, forwardDuration } from "./lib/boomerangMath";
import "./App.css";

type Step = "upload" | "trim" | "adjust" | "processing" | "result";

const DEFAULT_SEGMENT = 2;
const MIN_SEGMENT = 0.5;
const MAX_SEGMENT = 2;
const MAX_TOTAL_SECONDS = 12;
const MAX_LOOPS_CAP = 10;

function App() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [segmentDuration, setSegmentDuration] = useState(DEFAULT_SEGMENT);
  const [loops, setLoops] = useState(3);
  const [speed, setSpeed] = useState<Speed>(1);
  const [mode, setMode] = useState<Mode>("classic");
  const [resolution, setResolution] = useState<Resolution>("original");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState("Preparando…");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [previewClipUrl, setPreviewClipUrl] = useState<string | null>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);
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

  // However fast/slow or "ease" the ping-pong plays, the final export must
  // never exceed MAX_TOTAL_SECONDS — so the loop count's own max is derived
  // live from the current segment/speed/mode instead of being a fixed number.
  const maxLoops = useMemo(() => {
    const fwd = forwardDuration(mode, speed, clampedSegmentDuration);
    if (fwd <= 0) return 1;
    return Math.max(1, Math.min(MAX_LOOPS_CAP, Math.floor(MAX_TOTAL_SECONDS / (fwd * 2))));
  }, [mode, speed, clampedSegmentDuration]);

  useEffect(() => {
    setLoops((current) => Math.min(current, maxLoops));
  }, [maxLoops]);

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
        speed,
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
  }, [file, start, clampedSegmentDuration, loops, resolution, speed, mode]);

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

  const handleRandomize = useCallback(() => {
    const speeds: Speed[] = [0.5, 1, 1.5, 2];
    const randomSpeed = speeds[Math.floor(Math.random() * speeds.length)];
    const fwd = forwardDuration(mode, randomSpeed, clampedSegmentDuration);
    const randomMaxLoops = Math.max(1, Math.min(MAX_LOOPS_CAP, Math.floor(MAX_TOTAL_SECONDS / (fwd * 2))));
    setSpeed(randomSpeed);
    setLoops(Math.floor(Math.random() * randomMaxLoops) + 1);
  }, [mode, clampedSegmentDuration]);

  const totalDuration = useMemo(
    () => totalBoomerangDuration(mode, speed, clampedSegmentDuration, loops),
    [mode, speed, clampedSegmentDuration, loops],
  );

  return (
    <div className="app">
      <header className="app__header">
        <img src="/favicon.svg" alt="" className="app__logo" width="36" height="36" />
        <div>
          <h1 className="app__title">frangellboom</h1>
          <p className="app__tagline">boomerangs en alta calidad, a tu manera</p>
        </div>
      </header>

      <main className="app__main">
        {step === "upload" && <VideoUploader onSelect={handleSelect} error={error} />}

        {step === "trim" && videoUrl && (
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
                  <span>✂️ Duración del tramo</span>
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
                Cambiar video
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
        )}

        {(step === "adjust" || step === "processing") && videoUrl && (
          <div className="editor">
            <BoomerangPreview
              videoUrl={previewClipUrl ?? videoUrl}
              start={previewClipUrl ? 0 : start}
              duration={clampedSegmentDuration}
              speed={speed}
              mode={mode}
            />

            <p className="total-duration">
              Tramo: <strong>{clampedSegmentDuration.toFixed(1)}s</strong> · Duración total:{" "}
              <strong>{totalDuration.toFixed(1)}s</strong>
            </p>

            <BoomerangControls
              loops={loops}
              onLoopsChange={setLoops}
              maxLoops={maxLoops}
              speed={speed}
              onSpeedChange={setSpeed}
              mode={mode}
              onModeChange={setMode}
              resolution={resolution}
              onResolutionChange={setResolution}
              onRandomize={handleRandomize}
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
        )}

        {step === "processing" && (
          <div className="app__overlay">
            <ProcessingOverlay progress={progress} label={processingLabel} />
          </div>
        )}

        {step === "result" && resultBlob && <ResultView blob={resultBlob} onReset={handleReset} />}
      </main>
    </div>
  );
}

export default App;
