'use client';

import { useEffect } from 'react';

/** Registrerer service worker for offline-cache (kun i produksjon). */
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
