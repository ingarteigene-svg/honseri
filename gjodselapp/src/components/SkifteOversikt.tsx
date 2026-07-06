'use client';

import { useMemo, useState } from 'react';
import { useEntries } from '@/store/entries';
import { useSettings } from '@/store/settings';
import { PBar, StatusChip } from './ui';
import { round, statusFor } from '@/lib/calc';
import { fmtNum } from '@/lib/format';

interface SkifteSum {
  skifte: string;
  count: number;
  lass: number;
  tonn: number;
  areal: number; // fra siste levering
  sumP: number; // akkumulert kg P/daa
}

export default function SkifteOversikt() {
  const entries = useEntries((s) => s.entries);
  const pGrense = useSettings((s) => s.pGrense);
  const [yearSel, setYearSel] = useState('');

  const years = useMemo(
    () => [...new Set(entries.map((e) => e.dato.slice(0, 4)))].sort().reverse(),
    [entries],
  );
  const year = yearSel || years[0] || '';

  const rows = useMemo(() => {
    const map = new Map<string, SkifteSum>();
    entries
      .filter((e) => e.dato.startsWith(year))
      .sort((a, b) => a.dato.localeCompare(b.dato))
      .forEach((e) => {
        const s =
          map.get(e.skifte) ?? { skifte: e.skifte, count: 0, lass: 0, tonn: 0, areal: 0, sumP: 0 };
        s.count += 1;
        s.lass += e.lass;
        s.tonn = round(s.tonn + e.totalTonn, 2);
        s.areal = e.areal; // siste levering vinner
        s.sumP = round(s.sumP + e.pPerDaa, 2);
        map.set(e.skifte, s);
      });
    return [...map.values()].sort((a, b) => b.sumP - a.sumP);
  }, [entries, year]);

  if (entries.length === 0) {
    return <div className="py-16 text-center text-sm text-muted">Ingen registreringer ennå.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="form-label">P-belastning per skifte</div>
        {years.length > 1 && (
          <select
            className="input-field w-auto py-1.5"
            value={year}
            onChange={(e) => setYearSel(e.target.value)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="text-xs text-muted">
        Grense: {fmtNum(pGrense)} kg P/daa ({year})
      </div>

      {rows.map((s) => {
        const pct = pGrense > 0 ? (s.sumP / pGrense) * 100 : 0;
        return (
          <div key={s.skifte} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold leading-tight">{s.skifte}</div>
                <div className="text-xs text-muted">
                  {s.count} {s.count === 1 ? 'levering' : 'leveringer'} · {s.lass} lass ·{' '}
                  {fmtNum(s.tonn)} t · {fmtNum(s.areal)} daa
                </div>
              </div>
              <StatusChip status={statusFor(s.sumP, pGrense)} />
            </div>
            <PBar value={s.sumP} max={pGrense} />
            <div className="text-xs text-muted">
              <span className="font-medium text-ink">{fmtNum(s.sumP)}</span> av {fmtNum(pGrense)} kg
              P/daa ({Math.round(pct)} %)
            </div>
          </div>
        );
      })}
    </div>
  );
}
