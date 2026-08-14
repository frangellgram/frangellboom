import { useCallback, useRef, useState } from "react";

interface VideoUploaderProps {
  onSelect: (file: File) => void;
  error?: string | null;
}

export function VideoUploader({ onSelect, error }: VideoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recordInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file && file.type.startsWith("video/")) {
        onSelect(file);
      }
    },
    [onSelect],
  );

  return (
    <div className="uploader-group">
      <div
        className={`uploader${dragging ? " uploader--dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="uploader__input"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="uploader__icon">🎥</div>
        <p className="uploader__title">Importa tu video</p>
        <p className="uploader__hint">
          Arrastra un clip aquí o toca para elegirlo. Graba unos segundos con la cámara
          original de tu dispositivo.
        </p>
        {error && <p className="uploader__error">{error}</p>}
      </div>

      {/* `capture="environment"` sends mobile browsers straight into the
          native camera app instead of the photo library picker — the actual
          system Camera app records the file, so there's none of the
          getUserMedia/MediaRecorder orientation and quality quirks a custom
          in-page recorder has on iOS Safari. Ignored gracefully on desktop,
          where it just behaves like the picker above. */}
      <button
        type="button"
        className="btn btn--ghost uploader__record-btn"
        onClick={() => recordInputRef.current?.click()}
      >
        <span className="uploader__record-dot" aria-hidden="true" />
        Grabar video
      </button>
      <input
        ref={recordInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="uploader__input"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="uploader__badges">
        <span className="badge">100% en tu dispositivo</span>
        <span className="uploader__badges-dot" aria-hidden="true" />
        <span className="badge">Sin límites de calidad</span>
      </div>
    </div>
  );
}
