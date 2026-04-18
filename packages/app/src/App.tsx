import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

export function App(): JSX.Element {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Excalidraw />
    </div>
  );
}
