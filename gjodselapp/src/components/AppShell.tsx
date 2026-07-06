'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useSync } from './Providers';
import { formatDate, todayISO } from '@/lib/format';

/** Rendrer først etter mount – unngår hydreringsavvik mot localStorage-data. */
export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

function SyncBadge() {
  const { configured, account } = useAuth();
  const { pendingCount, syncing } = useSync();
  if (syncing) return <span className="chip bg-cyan-soft text-cyan">Synkroniserer…</span>;
  if (pendingCount > 0) return <span className="chip bg-warn-soft text-warn">{pendingCount} venter</span>;
  if (configured && account) return <span className="chip bg-primary-soft text-primary">Synkronisert</span>;
  return null;
}

const NAV = [
  { href: '/', label: 'Registrer', emoji: '📝' },
  { href: '/logg', label: 'Logg', emoji: '📒' },
  { href: '/skifter', label: 'Per skifte', emoji: '🌾' },
  { href: '/innstillinger', label: 'Innstillinger', emoji: '⚙️' },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [today, setToday] = useState('');
  useEffect(() => setToday(formatDate(todayISO())), []);

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20 border-b border-line backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top)', background: 'rgba(12,17,28,0.9)' }}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-card text-2xl shadow-[0_4px_18px_rgba(0,0,0,0.35)]">
              🚜
            </div>
            <div>
              <h1 className="text-xl font-extrabold leading-tight tracking-wide">GJØDSEL</h1>
              <div className="text-xs text-dim">Klokkargarden · Hareid</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-xs text-dim">{today}</div>
            <ClientOnly>
              <SyncBadge />
            </ClientOnly>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-32 pt-4">
        <ClientOnly>{children}</ClientOnly>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', background: 'rgba(18,26,41,0.94)' }}
      >
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {NAV.map(({ href, label, emoji }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold ${
                  active ? 'text-warn' : 'text-dim'
                }`}
              >
                <span className="text-[1.35rem] leading-none">{emoji}</span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
