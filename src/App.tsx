import { GestureProvider } from './gesture/GestureProvider';
import { HandOverlay } from './components/HandOverlay';
import Instrument from './instrument/Instrument';

export default function App() {
  return (
    <GestureProvider>
      <Instrument />
      <HandOverlay />
    </GestureProvider>
  );
}
