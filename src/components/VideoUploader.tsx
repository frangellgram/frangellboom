import { useCallback, useRef, useState } from "react";
import { VideoRecorder } from "./VideoRecorder";

interface VideoUploaderProps {
  onSelect: (file: File) => void;
  onRecord: (file: File) => void;
  error?: string | null;
}

// Only show the record option where it can actually work — iOS Safari and
// most modern mobile browsers, not e.g. an old WebView without MediaRecorder.
const canRecord =
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof MediaRecorder !== "undefined";

export function VideoUploader({ onSelect, onRecord, error }: VideoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);

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

      {canRecord && (
        <button type="button" className="btn btn--ghost uploader__record-btn" onClick={() => setRecording(true)}>
          <span className="uploader__record-dot" aria-hidden="true" />
          Grabar video
        </button>
      )}

      <div className="uploader__badges">
        <span className="badge">100% en tu dispositivo</span>
        <span className="uploader__badges-dot" aria-hidden="true" />
        <span className="badge">Sin límites de calidad</span>
      </div>

      {recording && (
        <VideoRecorder
          onCapture={(file) => {
            setRecording(false);
            onRecord(file);
          }}
          onCancel={() => setRecording(false)}
        />
      )}
    </div>
  );
}
