'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEntries } from '@/store/entries';
import { useSettings } from '@/store/settings';
import { useAuth, useSync } from './Providers';
import { useToast } from './Toast';
import { Field, PBar, StatusChip } from './ui';
import { accumulatedP, calcDelivery, round, statusFor } from '@/lib/calc';
import { fmtNum, todayISO } from '@/lib/format';
import { Entry } from '@/lib/types';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export default function RegistrerForm() {
  const settings = useSettings();
  const entries = useEntries((s) => s.entries);
  const add = useEntries((s) => s.add);
  const { configured, account } = useAuth();
  const { syncNow } = useSync();
  const toast = useToast();

  const [dato, setDato] = useState('');
  const [skifte, setSkifte] = useState('');
  const [mottaker, setMottaker] = useState('');
  const [lass, setLass] = useState('');
  const [areal, setAreal] = useState('');

  useEffect(() => setDato(todayISO()), []);

  // Autocomplete fra tidligere leveringer
  const skifter = useMemo(
    () => [...new Set(entries.map((e) => e.skifte).filter(Boolean))].sort(),
    [entries],
  );

  /** Ved kjent skifte: fyll inn arealet fra forrige levering automatisk. */
  function onSkifteChange(value: string) {
    setSkifte(value);
    const prev = [...entries].reverse().find((e) => e.skifte === value);
    if (prev) setAreal(String(prev.areal));
  }

  // Live-beregning mens man taster
  const lassN = parseInt(lass, 10);
  const arealN = parseFloat(areal.replace(',', '.'));
  const inputValid = !Number.isNaN(lassN) && lassN >= 1 && !Number.isNaN(arealN) && arealN > 0;
  const preview = inputValid ? calcDelivery(lassN, arealN, settings) : null;
  const year = dato.slice(0, 4);
  const accBefore = skifte.trim() ? accumulatedP(entries, skifte.trim(), year) : 0;
  const accAfter = preview ? round(accBefore + preview.pPerDaa, 2) : accBefore;
  const previewStatus = preview ? statusFor(accAfter, settings.pGrense) : null;

  function save() {
    if (!dato || !skifte.trim() || !inputValid) {
      toast('Fyll ut dato, skifte, antall lass og areal', true);
      return;
    }
    const c = calcDelivery(lassN, arealN, settings);
    const acc = round(accumulatedP(entries, skifte.trim(), year) + c.pPerDaa, 2);
    const entry: Entry = {
      id: newId(),
      dato,
      skifte: skifte.trim(),
      mottaker: mottaker.trim(),
      lass: lassN,
      areal: arealN,
      ...c,
      status: statusFor(acc, settings.pGrense),
      synced: false,
    };
    add(entry);
    navigator.vibrate?.(10); // haptisk kvittering

    const willSync =
      configured && account && Boolean(useSettings.getState().fileId) && navigator.onLine;
    toast(willSync ? 'Registrert ✓' : 'Lagret lokalt – synkroniseres når tilkoblet');
    if (willSync) void syncNow();

    setSkifte('');
    setMottaker('');
    setLass('');
    setAreal('');
    setDato(todayISO());
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Field label="Dato" required>
          <input
            type="date"
            className="input-field"
            value={dato}
            onChange={(e) => setDato(e.target.value)}
          />
        </Field>

        <Field label="Skiftenavn" required>
          <input
            type="text"
            className="input-field"
            list="skifte-list"
            placeholder="F.eks. Elvane"
            autoComplete="off"
            autoCapitalize="sentences"
            value={skifte}
            onChange={(e) => onSkifteChange(e.target.value)}
          />
          <datalist id="skifte-list">
            {skifter.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Mottaker / navn">
          <input
            type="text"
            className="input-field"
            placeholder="Fritekst"
            value={mottaker}
            onChange={(e) => setMottaker(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Antall lass" required>
            <input
              type="number"
              className="input-field"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="0"
              value={lass}
              onChange={(e) => setLass(e.target.value)}
            />
          </Field>
          <Field label="Areal (daa)" required>
            <input
              type="number"
              className="input-field"
              inputMode="decimal"
              min={0}
              step={0.1}
              placeholder="0"
              value={areal}
              onChange={(e) => setAreal(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {preview && previewStatus && (
        <div className="card space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold">{fmtNum(preview.totalTonn)} t</div>
              <div className="text-[0.65rem] uppercase tracking-wide text-muted">Total mengde</div>
            </div>
            <div>
              <div className="text-lg font-bold">{fmtNum(preview.kgPerDaa)}</div>
              <div className="text-[0.65rem] uppercase tracking-wide text-muted">kg/daa</div>
            </div>
            <div>
              <div className="text-lg font-bold">{fmtNum(preview.pPerDaa)}</div>
              <div className="text-[0.65rem] uppercase tracking-wide text-muted">kg P/daa</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {skifte.trim() || 'Skiftet'} i {year}: {fmtNum(accAfter)} av {fmtNum(settings.pGrense)} kg P/daa
              </span>
              <StatusChip status={previewStatus} />
            </div>
            <PBar value={accAfter} max={settings.pGrense} />
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={save}>
        Registrer levering
      </button>
    </div>
  );
}
