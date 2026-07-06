'use client';

import { useEffect } from 'react';

/** Registrerer service worker for offline-cache (kun i produksjon). */
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
      navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {});
    }
  }, []);
  return null;
}
