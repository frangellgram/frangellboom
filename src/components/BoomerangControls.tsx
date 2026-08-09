import type { CSSProperties } from "react";
import type { Mode, Resolution, Speed } from "../lib/boomerang";

type AccentStyle = CSSProperties & { "--row-accent"?: string };

interface BoomerangControlsProps {
  loops: number;
  onLoopsChange: (value: number) => void;
  maxLoops: number;
  speed: Speed;
  onSpeedChange: (value: Speed) => void;
  mode: Mode;
  onModeChange: (value: Mode) => void;
  resolution: Resolution;
  onResolutionChange: (value: Resolution) => void;
  onRandomize: () => void;
}

// Matches App.tsx's MAX_LOOPS_CAP — the UI-only sanity ceiling, separate
// from the 12s-duration-derived cap that usually kicks in first.
const ABSOLUTE_MAX_LOOPS = 10;

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "classic", label: "🎯 Clásico" },
  { value: "ease", label: "🌊 Ease" },
];

const SPEED_OPTIONS: { value: Speed; label: string }[] = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 1.5, label: "1.5×" },
  { value: 2, label: "2×" },
];

const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

export function BoomerangControls({
  loops,
  onLoopsChange,
  maxLoops,
  speed,
  onSpeedChange,
  mode,
  onModeChange,
  resolution,
  onResolutionChange,
  onRandomize,
}: BoomerangControlsProps) {
  return (
    <div className="controls">
      <div className="controls__header">
        <span className="controls__heading">Ajustes</span>
        <button type="button" className="dice-btn" onClick={onRandomize} title="Sorpréndeme">
          🎲 Sorpréndeme
        </button>
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent-3)" } as AccentStyle}>
        <span className="controls__label">
          <span>🔁 Repeticiones</span>
          <span className="controls__value">×{loops}</span>
        </span>
        <div className="chips" role="group" aria-label="Repeticiones disponibles">
          {Array.from({ length: maxLoops }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`chip${n === loops ? " chip--active" : ""}`}
              onClick={() => onLoopsChange(n)}
              aria-current={n === loops}
            >
              ×{n}
            </button>
          ))}
        </div>
        {maxLoops < ABSOLUTE_MAX_LOOPS && (
          <p className="controls__note">
            Con esta velocidad y modo, {maxLoops === 1 ? "solo entra 1 repetición" : `entran hasta ${maxLoops}`} sin pasar los 12s.
          </p>
        )}
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent-4)" } as AccentStyle}>
        <span className="controls__label">
          <span>⚡ Velocidad</span>
        </span>
        <div className="chips">
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip${speed === opt.value ? " chip--active" : ""}`}
              onClick={() => onSpeedChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent)" } as AccentStyle}>
        <span className="controls__label">
          <span>🎬 Modo</span>
        </span>
        <div className="chips">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip${mode === opt.value ? " chip--active" : ""}`}
              onClick={() => onModeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent-2)" } as AccentStyle}>
        <span className="controls__label">
          <span>✨ Calidad de salida</span>
        </span>
        <div className="chips">
          {RESOLUTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip${resolution === opt.value ? " chip--active" : ""}`}
              onClick={() => onResolutionChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
