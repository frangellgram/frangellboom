import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoUploader } from "./components/VideoUploader";
import { BoomerangMark } from "./components/BoomerangMark";
import { VideoTrimmer } from "./components/VideoTrimmer";
import { BoomerangPreview } from "./components/BoomerangPreview";
import { BoomerangControls } from "./components/BoomerangControls";
import { ProcessingOverlay } from "./components/ProcessingOverlay";
import { ResultView } from "./components/ResultView";
import { getFFmpeg, withFFmpeg, resetFFmpeg } from "./lib/ffmpegClient";
import { createBoomerang, type Resolution, type Speed, type Mode } from "./lib/boomerang";
import { extractPreviewClip } from "./lib/previewClip";
import { totalBoomerangDuration, deriveLoops } from "./lib/boomerangMath";
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
  // Recorded clips are always exactly MAX_SEGMENT already — there's nothing
  // left to trim, so "adjust" needs to know not to offer going back to a
  // trim step that would have nothing meaningful to show.
  const [fileSource, setFileSource] = useState<"upload" | "record">("upload");
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

  const handleSelect = useCallback((selected: File) => {
    setError(null);
    setFileSource("upload");
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

  // Recorded clips come out of VideoRecorder already at exactly MAX_SEGMENT
  // (2s) — the max the trim step would ever allow — so there's nothing left
  // to trim. Skips straight to "adjust" instead of "trim", mirroring
  // handleSelect (set up state) followed by handleGoToAdjust (build the
  // scrub preview) in one go.
  const handleRecorded = useCallback((recorded: File) => {
    setError(null);
    setFileSource("record");
    setFile(recorded);
    setDuration(MAX_SEGMENT);
    setStart(0);
    setSegmentDuration(MAX_SEGMENT);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(recorded);
    });
    setPreviewClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    // Jump to "adjust" immediately instead of waiting on the (ffmpeg-driven)
    // scrub-preview clip first — that call can take a couple of seconds
    // (cold-loading the wasm core included), and blocking the transition on
    // it meant the bare upload screen flashed back into view for that whole
    // stretch before suddenly jumping to "adjust". BoomerangPreview already
    // has a graceful fallback for exactly this case (videoUrl ??
    // previewClipUrl below): it scrubs the freshly recorded file directly
    // until the nicer preview clip is ready, then swaps over on its own.
    setStep("adjust");

    setPreparingPreview(true);
    withFFmpeg((ffmpeg) => extractPreviewClip(ffmpeg, recorded, { start: 0, duration: MAX_SEGMENT }))
      .then((clip) => {
        setPreviewClipUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(clip);
        });
      })
      .catch((err) => {
        console.error(err);
        // Non-fatal, same as handleGoToAdjust: BoomerangPreview falls back
        // to scrubbing the original file directly.
      })
      .finally(() => {
        setPreparingPreview(false);
      });
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
    try {
      setProcessingLabel("Cargando el motor de video…");
      await getFFmpeg();
      setProcessingLabel("Creando tu boomerang…");
      const blob = await withFFmpeg((ffmpeg) =>
        createBoomerang(ffmpeg, file, {
          start,
          duration: clampedSegmentDuration,
          loops,
          resolution,
          speed: effectiveSpeed,
          mode,
          onProgress: setProgress,
        }),
      );
      setResultBlob(blob);
      setOverlayLeaving(true);
      await new Promise((resolve) => window.setTimeout(resolve, OVERLAY_LEAVE_MS));
      setStep("result");
    } catch (err) {
      console.error(err);
      setError("No se pudo procesar el video. Probá con un clip más corto o recargá la página.");
      setStep("adjust");
    } finally {
      // Exporting is by far the heaviest thing ffmpeg does here (especially
      // with chunked reverses at 2K/Original), so its memory footprint is
      // what eventually trips the "memory access out of bounds" crash after
      // a few runs. Starting the next export from a freshly-loaded instance
      // — win or lose — keeps that from ever accumulating that far.
      resetFFmpeg().catch(() => {});
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

  // Fixed note, not tied to a detected fps value or the current speed —
  // probing the actual source fps turned out unreliable in practice, and
  // toggling this on/off between 0.5x and 1x just made it flicker as people
  // compared speeds. It stays visible for the whole "classic" mode instead,
  // and only disappears once they switch to a different mode entirely.
  const showFpsNote = mode === "classic";

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
            <VideoUploader onSelect={handleSelect} onRecord={handleRecorded} error={error} />
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
                {fileSource === "record" ? (
                  // A recorded clip is always exactly MAX_SEGMENT already —
                  // there's no trim step to go back to, so this restarts
                  // from the beginning (pick a file, or record again)
                  // instead of showing a "2.1s" trim screen with nothing
                  // real left to trim.
                  <button type="button" className="btn btn--ghost" onClick={handleReset}>
                    ← Volver
                  </button>
                ) : (
                  <button type="button" className="btn btn--ghost" onClick={() => setStep("trim")}>
                    ← Recortar
                  </button>
                )}
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
                  <p className="fps-note">
                    Si tu video fue grabado a 30fps, a 0.5x el movimiento puede verse algo entrecortado en vez de un
                    slow motion fluido. Para un resultado más suave, grabá (o usá) un video a 60fps o más.
                  </p>
                </div>
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
