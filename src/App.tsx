import { GestureProvider } from './gesture/GestureProvider';
import { HandOverlay } from './components/HandOverlay';
import { VideoBackdrop } from './components/VideoBackdrop';
import Instrument from './instrument/Instrument';

export default function App() {
  return (
    <GestureProvider>
      <VideoBackdrop />
      <Instrument />
      <HandOverlay />
    </GestureProvider>
  );
}
