'use client';

import { Status } from '@/lib/types';

/** EGGLY-seksjonsoverskrift: farga prikk + emoji + sperra tekst + linje. */
export function SectionHeader({
  emoji,
  dot = 'bg-cyan',
  children,
}: {
  emoji: string;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-muted">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** EGGLY-nøkkeltallflis: emoji, dempet etikett og stor farga verdi. */
export function StatTile({
  emoji,
  label,
  value,
  unit,
  tone = 'ink',
}: {
  emoji: string;
  label: string;
  value: string;
  unit?: string;
  tone?: 'ink' | 'cyan' | 'warn' | 'primary';
}) {
  const toneCls = {
    ink: 'text-ink',
    cyan: 'text-cyan',
    warn: 'text-warn',
    primary: 'text-primary',
  }[tone];
  return (
    <div className="card flex flex-col items-center gap-1.5 px-2 py-4 text-center">
      <span className="text-2xl leading-none">{emoji}</span>
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-2xl font-extrabold leading-tight ${toneCls}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-dim">{unit}</span>}
      </span>
    </div>
  );
}

export function StatusChip({ status }: { status: Status }) {
  const cls =
    status === 'OK'
      ? 'bg-primary-soft text-primary'
      : status === 'NÆR GRENSE'
        ? 'bg-warn-soft text-warn'
        : 'bg-danger-soft text-danger';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function SyncChip({ synced }: { synced: boolean }) {
  return synced ? (
    <span className="chip bg-primary-soft text-primary">Synkronisert</span>
  ) : (
    <span className="chip bg-warn-soft text-warn">Venter</span>
  );
}

/** Progressbar for P-belastning mot grensen. */
export function PBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = value > max ? 'bg-danger' : value >= 0.9 * max ? 'bg-warn' : 'bg-primary';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-card-2">
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-200`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="form-label">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
