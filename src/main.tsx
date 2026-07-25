/**
 * Application entry — Phase 0. Mounts the Arabic RTL shell only.
 * No engines, routing, or session logic are wired.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './ui/app-shell/AppShell';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
