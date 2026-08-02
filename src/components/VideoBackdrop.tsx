import { useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

/** Live mirrored camera feed filling the stage, with an adaptive shade on
 *  top so white ink always reads — the parent sets the shade opacity. */
export function VideoBackdrop({ shade }: { shade: number }) {
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
      <div className="video-shade" style={{ opacity: shade }} />
    </div>
  );
}
