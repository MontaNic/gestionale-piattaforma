import { redirect } from 'next/navigation';

// =============================================================================
// page.tsx — Root entrypoint (TD-2 ADR-0012)
// =============================================================================
// Redirect a default tenant dev (`/t/demo/login`). Il middleware
// (`src/middleware.ts`) gestisce gia' lo stesso redirect lato edge, ma
// duplicato qui come fallback se il middleware viene bypassato (es. preview
// SSR, deployment edge differenti).
//
// NB: server component (no 'use client'). `redirect()` di next/navigation
// e' server-only.
// =============================================================================
export default function Home(): never {
  redirect('/t/demo/login');
}
