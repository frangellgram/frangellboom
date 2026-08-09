import { useCallback, useEffect, useRef } from "react";

interface VideoTrimmerProps {
  videoUrl: string;
  duration: number;
  start: number;
  segmentDuration: number;
  onStartChange: (start: number) => void;
  onDurationChange: (duration: number) => void;
}

export function VideoTrimmer({
  videoUrl,
  duration,
  start,
  segmentDuration,
  onStartChange,
  onDurationChange,
}: VideoTrimmerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetStart: number } | null>(null);

  const clampStart = useCallback(
    (value: number) => Math.min(Math.max(value, 0), Math.max(duration - segmentDuration, 0)),
    [duration, segmentDuration],
  );

  const startFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      return fraction * duration;
    },
    [duration],
  );

  const handleWindowPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const clickedAt = startFromClientX(e.clientX);
    dragRef.current = { pointerId: e.pointerId, offsetStart: clickedAt - start };
  };

  const handleWindowPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    const raw = startFromClientX(e.clientX) - dragRef.current.offsetStart;
    onStartChange(clampStart(raw));
  };

  const handleWindowPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragRef.current) return;
    const clicked = startFromClientX(e.clientX) - segmentDuration / 2;
    onStartChange(clampStart(clicked));
  };

  useEffect(() => {
    onStartChange(clampStart(start));
    // Re-clamp whenever duration/segment length change (e.g. slider edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, segmentDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.currentTime = start;
  }, [start]);

  const leftPct = duration > 0 ? (start / duration) * 100 : 0;
  const widthPct = duration > 0 ? (segmentDuration / duration) * 100 : 0;

  return (
    <div className="trimmer">
      <div className="trimmer__video-wrap">
        <video
          ref={videoRef}
          src={videoUrl}
          className="trimmer__video"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            onDurationChange(e.currentTarget.duration);
            // iOS Safari never decodes a frame for a <video> that hasn't
            // played yet, so seeking alone leaves it black. A silent
            // play/pause "primes" the decoder before we start scrubbing it.
            e.currentTarget.play().then(() => e.currentTarget.pause()).catch(() => {});
          }}
        />
      </div>

      <div ref={trackRef} className="trimmer__track" onClick={handleTrackClick}>
        <div
          className="trimmer__window"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={handleWindowPointerDown}
          onPointerMove={handleWindowPointerMove}
          onPointerUp={handleWindowPointerUp}
        />
      </div>
      <div className="trimmer__labels">
        <span>{formatTime(start)}</span>
        <span>{formatTime(start + segmentDuration)} · {segmentDuration.toFixed(1)}s seleccionados</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${s.toFixed(1)}s`;
}
