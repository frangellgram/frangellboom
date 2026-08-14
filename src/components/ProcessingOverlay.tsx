import { useEffect, useState } from "react";
import { BoomerangMark } from "./BoomerangMark";

interface ProcessingOverlayProps {
  progress: number;
  label: string;
}

const FLAVOR_TEXT = [
  "Dándole la vuelta a los píxeles…",
  "Afinando el ida y vuelta…",
  "Puliendo cada cuadro…",
  "Ya casi vuela",
];

export function ProcessingOverlay({ progress, label }: ProcessingOverlayProps) {
  const pct = Math.round(progress * 100);
  const [flavorIndex, setFlavorIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFlavorIndex((i) => (i + 1) % FLAVOR_TEXT.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="processing">
      <div className="processing__spinner-wrap">
        <div className="processing__spinner" aria-hidden="true">
          <BoomerangMark className="processing__mark" />
        </div>
      </div>
      <p className="processing__label">{label}</p>
      <p className="processing__flavor">{FLAVOR_TEXT[flavorIndex]}</p>
      <div className="processing__bar">
        <div className="processing__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="processing__pct">{pct}%</p>
    </div>
  );
}
