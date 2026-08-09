interface BoomerangMarkProps {
  className?: string;
}

// The app's actual arc glyph (same shape as favicon.svg/the app icon), with
// no background box, colored via currentColor — for inline use next to text
// (buttons, spinners) where a full icon tile would look redundant.
export function BoomerangMark({ className }: BoomerangMarkProps) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" aria-hidden="true">
      <path
        d="M150,340 C150,260 190,172 256,172 C322,172 362,260 362,340"
        stroke="currentColor"
        strokeWidth="54"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
