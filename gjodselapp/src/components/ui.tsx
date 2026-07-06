'use client';

import { Status } from '@/lib/types';

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
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
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
