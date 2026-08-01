import { useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

/** Small mirrored camera preview inside the CAM sheet. Tracking runs whether
 *  or not this tile is mounted — this is just a viewfinder. */
export function CamTile() {
  const { videoEl, source } = useGestures();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !videoEl) return;
    videoEl.className = 'gw-cam-video';
    host.appendChild(videoEl);
    return () => {
      if (videoEl.parentElement === host) host.removeChild(videoEl);
    };
  }, [videoEl]);

  return (
    <div className="gw-cam-tile" ref={hostRef} data-testid="cam-tile">
      {(source !== 'camera' || !videoEl) && (
        <span className="gw-cam-empty">no camera — mouse mode</span>
      )}
    </div>
  );
}
