import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode is intentionally omitted: it double-invokes effects in dev,
// which would open two WebSocket game connections per join.
createRoot(document.getElementById('root')!).render(<App />);
