import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Registro único del Service Worker centralizado en PWAUpdateBanner (useRegisterSW).
// Capturamos errores de precarga de chunks desfasados (nueva versión publicada mientras
// la pestaña seguía abierta) sin recargar a ciegas si hay formularios o escrituras abiertas.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online) {
      window.dispatchEvent(new CustomEvent('nido:stale-chunk'));
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
