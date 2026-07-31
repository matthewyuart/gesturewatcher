import { useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

/** Small mirrored camera preview in the corner so you can see yourself. */
export function CameraPip() {
  const { videoEl, source } = useGestures();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !videoEl) return;
    videoEl.className = 'camera-pip-video';
    host.appendChild(videoEl);
    return () => {
      if (videoEl.parentElement === host) host.removeChild(videoEl);
    };
  }, [videoEl]);

  if (source !== 'camera' || !videoEl) return null;
  return <div ref={hostRef} className="camera-pip" />;
}
