import { useCallback, useEffect, useState } from "react";
import { Confetti } from "./Confetti";

interface ResultViewProps {
  blob: Blob;
  onReset: () => void;
}

// Matches the .result--leaving transition duration in App.css — gives the
// fade-out time to actually play before onReset swaps the whole screen out
// from under it, instead of "Crear otro" cutting straight back to "upload".
const LEAVE_MS = 250;

export function ResultView({ blob, onReset }: ResultViewProps) {
  // Create and revoke the object URL inside the same effect (rather than a
  // useMemo + separate cleanup effect) so React StrictMode's dev-only
  // mount→cleanup→remount doesn't revoke a URL that never gets recreated —
  // that mismatch was leaving `url` pointing at a dead blob in dev mode.
  const [url, setUrl] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  const handleReset = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onReset, LEAVE_MS);
  }, [onReset]);

  if (!url) return null;

  return (
    <div className={`result${leaving ? " result--leaving" : ""}`}>
      <Confetti />
      <p className="result__headline">¡Tu boomerang está listo!</p>
      <video src={url} className="result__video" autoPlay loop muted playsInline controls />
      <div className="result__actions">
        <a className="btn btn--primary" href={url} download="frangellboom.mp4">
          Descargar
        </a>
        <button type="button" className="btn btn--ghost" onClick={handleReset}>
          Crear otro
        </button>
      </div>
    </div>
  );
}
