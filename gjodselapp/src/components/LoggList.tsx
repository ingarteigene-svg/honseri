'use client';

import { useMemo } from 'react';
import { useEntries } from '@/store/entries';
import { useToast } from './Toast';
import { StatusChip, SyncChip } from './ui';
import { fmtNum, formatDate } from '@/lib/format';

export default function LoggList() {
  const entries = useEntries((s) => s.entries);
  const remove = useEntries((s) => s.remove);
  const toast = useToast();

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.dato.localeCompare(a.dato) || b.id.localeCompare(a.id)),
    [entries],
  );

  function handleDelete(id: string) {
    if (!window.confirm('Slette denne registreringen?')) return;
    remove(id);
    toast('Slettet');
  }

  if (sorted.length === 0) {
    return <div className="py-16 text-center text-sm text-muted">Ingen registreringer ennå.</div>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((e) => (
        <div key={e.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold leading-tight">{e.skifte}</div>
              {e.mottaker && <div className="text-xs text-muted">{e.mottaker}</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="text-xs text-muted">{formatDate(e.dato)}</div>
              <StatusChip status={e.status} />
            </div>
          </div>
          <div className="text-sm text-muted">
            {e.lass} lass · {fmtNum(e.totalTonn)} t · {fmtNum(e.areal)} daa · {fmtNum(e.kgPerDaa)}{' '}
            kg/daa · <span className="font-medium text-ink">{fmtNum(e.pPerDaa)} kg P/daa</span>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-2">
            <SyncChip synced={e.synced} />
            <button
              className="min-h-[44px] px-2 text-xs font-medium text-muted active:text-danger"
              onClick={() => handleDelete(e.id)}
            >
              Slett
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
