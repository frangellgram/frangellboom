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

// "original" is temporarily pulled from the picker — at native/4K+ source
// resolution the export pipeline buffers every decoded frame of the trimmed
// segment in memory before encoding, which blows well past iOS Safari's
// per-tab memory ceiling and crashes the whole page instead of failing
// gracefully. Re-add once that buffering is reworked to not need the full
// resolution held in memory at once.
const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
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
        <div className="controls__collapse-inner controls__collapse-inner--glow">
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
