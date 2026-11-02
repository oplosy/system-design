import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { CrashGuard } from './crash-guard.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard title="The app stopped" hint="Your designs are saved on disk and were not changed. Reload to carry on.">
      <App />
    </CrashGuard>
  </StrictMode>,
);
