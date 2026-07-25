import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 0: application shell only. No engine or business logic is wired here.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Deterministic-friendly build settings; no engine bundling in Phase 0.
    sourcemap: true,
  },
});
