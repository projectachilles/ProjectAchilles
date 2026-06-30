import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installChunkReloadHandler } from './lib/chunkReload';
import './styles/index.css';

// Recover stale clients that request a chunk a newer deploy has replaced.
installChunkReloadHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Report Web Vitals in development
if (import.meta.env.DEV) {
  import('./lib/vitals').then(({ reportWebVitals }) => reportWebVitals());
}
