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
  if (syncing) return <span className="chip bg-primary-soft text-primary">Synkroniserer…</span>;
  if (pendingCount > 0) return <span className="chip bg-warn-soft text-warn">{pendingCount} venter</span>;
  if (configured && account) return <span className="chip bg-primary-soft text-primary">Synkronisert</span>;
  return null;
}

/* Enkle ikoner, 22px, strek i currentColor */
const ic = { width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const PlusIcon = () => (
  <svg {...ic} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
);
const ListIcon = () => (
  <svg {...ic} viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.4" /></svg>
);
const ChartIcon = () => (
  <svg {...ic} viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
const GearIcon = () => (
  <svg {...ic} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" /></svg>
);

const NAV = [
  { href: '/', label: 'Registrer', Icon: PlusIcon },
  { href: '/logg', label: 'Logg', Icon: ListIcon },
  { href: '/skifter', label: 'Per skifte', Icon: ChartIcon },
  { href: '/innstillinger', label: 'Innstillinger', Icon: GearIcon },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [today, setToday] = useState('');
  useEffect(() => setToday(formatDate(todayISO())), []);

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20 border-b border-line bg-app"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold leading-tight">Gjødseljournal</h1>
            <div className="text-xs text-muted">Klokkargarden</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-xs text-muted">{today}</div>
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
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[0.65rem] font-medium ${
                  active ? 'text-primary' : 'text-muted'
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
