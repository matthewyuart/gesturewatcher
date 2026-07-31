import { useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

/** Fullscreen mirrored live camera feed behind the glass UI. */
export function VideoBackdrop() {
  const { videoEl, source } = useGestures();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !videoEl) return;
    videoEl.className = 'video-backdrop-video';
    host.appendChild(videoEl);
    return () => {
      if (videoEl.parentElement === host) host.removeChild(videoEl);
    };
  }, [videoEl]);

  return (
    <div className="video-backdrop" ref={hostRef}>
      {(source !== 'camera' || !videoEl) && <div className="video-backdrop-fallback" />}
      <div className="video-backdrop-tint" />
    </div>
  );
}
