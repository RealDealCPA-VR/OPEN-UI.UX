import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPalette, getStoredPalette } from './state/palette';
import './styles.css';

// Apply the saved color palette before first paint to avoid an accent flash.
applyPalette(getStoredPalette());

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
