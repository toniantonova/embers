/**
 * vitest.setup.ts — Global test setup file.
 *
 * WHY THIS FILE?
 * ──────────────
 * This file runs before every test file. It imports extended DOM matchers
 * from @testing-library/jest-dom, which adds methods like:
 *   - .toBeInTheDocument()
 *   - .toHaveStyle()
 *   - .toBeVisible()
 *   - .toHaveValue()
 *
 * Without this, you'd have to import these matchers in every test file,
 * which is verbose and easy to forget.
 *
 * INDUSTRY CONTEXT:
 * ──────────────────
 * This is the standard React Testing Library setup. Every project using
 * RTL has a file like this. It's configured in vite.config.ts under
 * test.setupFiles so Vitest loads it automatically.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';
