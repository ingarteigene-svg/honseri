'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEntries } from '@/store/entries';
import { useSettings } from '@/store/settings';
import { useSkifter } from '@/store/skifter';
import { useAuth, useSync } from './Providers';
import { useToast } from './Toast';
import { Field, PBar, StatusChip } from './ui';
import { accumulatedP, calcDelivery, round, statusFor } from '@/lib/calc';
import { fmtNum, newId, todayISO } from '@/lib/format';
import { Entry } from '@/lib/types';

const NYTT = '__nytt__';

export default function RegistrerForm() {
  const settings = useSettings();
  const entries = useEntries((s) => s.entries);
  const add = useEntries((s) => s.add);
  const skifter = useSkifter((s) => s.skifter);
  const addSkifte = useSkifter((s) => s.add);
  const { configured, account } = useAuth();
  const { syncNow } = useSync();
  const toast = useToast();

  const [dato, setDato] = useState('');
  const [sel, setSel] = useState(''); // skifte-id eller NYTT
  const [nyttNavn, setNyttNavn] = useState('');
  const [mottaker, setMottaker] = useState('');
  const [lass, setLass] = useState('');
  const [areal, setAreal] = useState('');

  useEffect(() => setDato(todayISO()), []);

  const sortedSkifter = useMemo(
    () => [...skifter].sort((a, b) => a.navn.localeCompare(b.navn, 'nb')),
    [skifter],
  );

  const valgt = skifter.find((s) => s.id === sel);
  const skifteNavn = sel === NYTT ? nyttNavn.trim() : (valgt?.navn ?? '');

  /** Fast skifte valgt → arealet fylles inn automatisk. */
  function onSelChange(value: string) {
    setSel(value);
    if (value && value !== NYTT) {
      const s = skifter.find((x) => x.id === value);
      if (s) setAreal(String(s.areal));
    } else {
      setAreal('');
    }
  }

  // Live-beregning mens man taster
  const lassN = parseInt(lass, 10);
  const arealN = parseFloat(areal.replace(',', '.'));
  const inputValid = !Number.isNaN(lassN) && lassN >= 1 && !Number.isNaN(arealN) && arealN > 0;
  const preview = inputValid ? calcDelivery(lassN, arealN, settings) : null;
  const year = dato.slice(0, 4);
  const accBefore = skifteNavn ? accumulatedP(entries, skifteNavn, year) : 0;
  const accAfter = preview ? round(accBefore + preview.pPerDaa, 2) : accBefore;
  const previewStatus = preview ? statusFor(accAfter, settings.pGrense) : null;

  function save() {
    if (!dato || !skifteNavn || !inputValid) {
      toast('Fyll ut dato, skifte, antall lass og areal', true);
      return;
    }
    // Nytt skifte lagres som fast skifte med arealet sitt
    if (sel === NYTT && !skifter.some((s) => s.navn.toLowerCase() === skifteNavn.toLowerCase())) {
      addSkifte(skifteNavn, arealN);
    }
    const c = calcDelivery(lassN, arealN, settings);
    const acc = round(accumulatedP(entries, skifteNavn, year) + c.pPerDaa, 2);
    const entry: Entry = {
      id: newId(),
      dato,
      skifte: skifteNavn,
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

    setSel('');
    setNyttNavn('');
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

        <Field label="Skifte" required>
          <select className="input-field" value={sel} onChange={(e) => onSelChange(e.target.value)}>
            <option value="">Velg skifte…</option>
            {sortedSkifter.map((s) => (
              <option key={s.id} value={s.id}>
                {s.navn} ({fmtNum(s.areal)} daa)
              </option>
            ))}
            <option value={NYTT}>+ Nytt skifte…</option>
          </select>
        </Field>

        {sel === NYTT && (
          <Field label="Navn på nytt skifte" required>
            <input
              type="text"
              className="input-field"
              placeholder="F.eks. Elvane"
              autoComplete="off"
              autoCapitalize="sentences"
              value={nyttNavn}
              onChange={(e) => setNyttNavn(e.target.value)}
            />
          </Field>
        )}

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
                {skifteNavn || 'Skiftet'} i {year}: {fmtNum(accAfter)} av{' '}
                {fmtNum(settings.pGrense)} kg P/daa
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
