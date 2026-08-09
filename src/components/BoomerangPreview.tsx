import { useRef, useState } from "react";
import { useBoomerangPreview } from "../hooks/useBoomerangPreview";
import type { Mode, Speed } from "../lib/boomerang";

interface BoomerangPreviewProps {
  videoUrl: string;
  start: number;
  duration: number;
  speed: Speed;
  mode: Mode;
}

export function BoomerangPreview({ videoUrl, start, duration, speed, mode }: BoomerangPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  useBoomerangPreview(videoRef, { sourceKey: videoUrl, start, duration, speed, mode, playing });

  return (
    <div className="preview">
      <video ref={videoRef} src={videoUrl} className="preview__video" muted playsInline />
      <span className="preview__live-badge">● EN VIVO</span>
      <button
        type="button"
        className="preview__toggle"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pausar vista previa" : "Reproducir vista previa"}
      >
        {playing ? "⏸" : "▶"}
      </button>
    </div>
  );
}
