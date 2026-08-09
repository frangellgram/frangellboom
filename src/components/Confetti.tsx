import { useMemo, type CSSProperties } from "react";

type PieceStyle = CSSProperties & { "--drift": string; "--rotate": string };

const COLORS = ["var(--accent)", "var(--accent-2)", "var(--accent-3)", "var(--accent-4)"];
const PIECE_COUNT = 28;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  rotate: number;
  color: string;
  size: number;
}

// Small self-contained confetti burst (no external library / CDN) that plays
// once when mounted — ResultView only renders this when a boomerang finishes.
export function Confetti() {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: PIECE_COUNT }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 1.6 + Math.random() * 1,
        drift: (Math.random() - 0.5) * 160,
        rotate: Math.random() * 720 - 360,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 6 + Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti__piece"
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size * 0.4}px`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              "--drift": `${p.drift}px`,
              "--rotate": `${p.rotate}deg`,
            } as PieceStyle
          }
        />
      ))}
    </div>
  );
}
