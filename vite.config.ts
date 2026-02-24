/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Use relative asset paths so the build works on GCS static hosting
  // (where files are served from a bucket path, not the domain root).
  base: './',

  // Workers must use ES module format to support code-splitting in production builds.
  // The SER worker is already instantiated with { type: 'module' }.
  worker: {
    format: 'es',
  },

  // ── VITEST CONFIGURATION ──────────────────────────────────────────
  // Vitest is Vite's native test runner. Because it shares the same Vite
  // transform pipeline, all our imports (React JSX, .glsl files, etc.)
  // work out of the box — no extra Babel/webpack config needed.
  //
  // WHY jsdom?
  // Our tests render React components (TuningPanel, UIOverlay) that
  // need a DOM. jsdom is a pure-JS DOM implementation that runs in Node,
  // so tests are fast and don't need a real browser.
  //
  // WHY setupFiles?
  // @testing-library/jest-dom adds matchers like .toBeInTheDocument(),
  // .toHaveStyle(), etc. Loading it in setup ensures all test files
  // have these matchers available without manual imports.
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
