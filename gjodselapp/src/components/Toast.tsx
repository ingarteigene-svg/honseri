'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

type ToastFn = (msg: string, isError?: boolean) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback<ToastFn>((msg, isError = false) => {
    setToast({ msg, isError });
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[10px] px-5 py-2.5 text-sm font-bold transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        } ${toast?.isError ? 'bg-danger text-white' : 'bg-primary text-[#0c111c]'}`}
      >
        {toast?.msg}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
