import type { CSSProperties } from "react";
import type { Mode, Resolution, Speed } from "../lib/boomerang";

type AccentStyle = CSSProperties & { "--row-accent"?: string };

interface BoomerangControlsProps {
  speed: Speed;
  onSpeedChange: (value: Speed) => void;
  mode: Mode;
  onModeChange: (value: Mode) => void;
  resolution: Resolution;
  onResolutionChange: (value: Resolution) => void;
}

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "classic", label: "Clásico" },
  { value: "ease", label: "Ease" },
  { value: "freeze", label: "Freeze" },
  { value: "pulse", label: "Pulso" },
  { value: "zoom", label: "Zoom" },
];

// Only "classic" exposes a speed picker (see App.tsx) — every other mode has
// a fixed, non-configurable motion, so only the two speeds that have a clear
// identity survive: normal and slow motion.
const SPEED_OPTIONS: { value: Speed; label: string }[] = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
];

const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "1440", label: "2K" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

export function BoomerangControls({
  speed,
  onSpeedChange,
  mode,
  onModeChange,
  resolution,
  onResolutionChange,
}: BoomerangControlsProps) {
  return (
    <div className="controls">
      <div className="controls__header">
        <span className="controls__heading">Ajustes</span>
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent)" } as AccentStyle}>
        <span className="controls__label">
          <span>Modo</span>
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

      <div className={`controls__collapse${mode === "classic" ? " controls__collapse--open" : ""}`}>
        <div className="controls__collapse-inner">
          <div className="controls__row" style={{ "--row-accent": "var(--accent-4)" } as AccentStyle}>
            <span className="controls__label">
              <span>Velocidad</span>
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
        </div>
      </div>

      <div className="controls__row" style={{ "--row-accent": "var(--accent-2)" } as AccentStyle}>
        <span className="controls__label">
          <span>Calidad de salida</span>
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
