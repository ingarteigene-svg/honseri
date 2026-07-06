'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEntries } from '@/store/entries';
import { useSettings } from '@/store/settings';
import { useSkifter } from '@/store/skifter';
import { useAuth, useSync } from './Providers';
import { useToast } from './Toast';
import { Field, SectionHeader } from './ui';
import { appRedirectUri } from '@/lib/msal';

/** Tallfelt med lokal tekst-tilstand slik at mellomtilstander («6,» osv.) fungerer. */
function NumField({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  suffix: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Field label={`${label} (${suffix})`}>
      <input
        type="number"
        className="input-field"
        inputMode="decimal"
        step={0.1}
        min={0}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value.replace(',', '.'));
          if (!Number.isNaN(n) && n > 0) onCommit(n);
        }}
      />
    </Field>
  );
}

/** Arealfelt med «daa»-suffiks og lokal tekst-tilstand. */
function ArealInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="relative shrink-0">
      <input
        type="number"
        className="input-field w-28 pr-10"
        inputMode="decimal"
        min={0}
        step={0.1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value.replace(',', '.'));
          if (!Number.isNaN(n) && n > 0) onCommit(n);
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
        daa
      </span>
    </div>
  );
}

/** Administrasjon av faste skifter – arealet fylles inn automatisk i felt. */
function SkifterAdmin() {
  const skifter = useSkifter((s) => s.skifter);
  const add = useSkifter((s) => s.add);
  const update = useSkifter((s) => s.update);
  const remove = useSkifter((s) => s.remove);
  const toast = useToast();
  const [navn, setNavn] = useState('');
  const [areal, setAreal] = useState('');

  const sorted = useMemo(
    () => [...skifter].sort((a, b) => a.navn.localeCompare(b.navn, 'nb')),
    [skifter],
  );

  function handleAdd() {
    const a = parseFloat(areal.replace(',', '.'));
    if (!navn.trim() || Number.isNaN(a) || a <= 0) {
      toast('Fyll ut skiftenavn og areal', true);
      return;
    }
    if (skifter.some((s) => s.navn.toLowerCase() === navn.trim().toLowerCase())) {
      toast('Skiftet finnes allerede', true);
      return;
    }
    add(navn.trim(), a);
    setNavn('');
    setAreal('');
    toast('Skifte lagt til');
  }

  function handleRemove(id: string, skifteNavn: string) {
    if (!window.confirm(`Slette skiftet «${skifteNavn}»? Registreringene i loggen beholdes.`)) return;
    remove(id);
    toast('Skifte slettet');
  }

  return (
    <section className="space-y-3">
      <SectionHeader emoji="🌾" dot="bg-primary">Faste skifter</SectionHeader>
      <div className="card space-y-3">
        {sorted.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <input
              type="text"
              className="input-field flex-1"
              value={s.navn}
              onChange={(e) => update(s.id, { navn: e.target.value })}
            />
            <ArealInput value={s.areal} onCommit={(n) => update(s.id, { areal: n })} />
            <button
              className="min-h-[44px] shrink-0 px-1.5 text-xs font-medium text-muted active:text-danger"
              onClick={() => handleRemove(s.id, s.navn)}
            >
              Slett
            </button>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-xs text-muted">Ingen faste skifter ennå. Legg til under.</p>
        )}
        <div className="flex items-center gap-2 border-t border-line pt-3">
          <input
            type="text"
            className="input-field flex-1"
            placeholder="Nytt skifte"
            value={navn}
            onChange={(e) => setNavn(e.target.value)}
          />
          <div className="relative shrink-0">
            <input
              type="number"
              className="input-field w-28 pr-10"
              inputMode="decimal"
              min={0}
              step={0.1}
              placeholder="0"
              value={areal}
              onChange={(e) => setAreal(e.target.value)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              daa
            </span>
          </div>
          <button className="btn-secondary shrink-0" onClick={handleAdd}>
            Legg til
          </button>
        </div>
        <p className="text-xs text-muted">
          Skiftene dukker opp i registreringsskjemaet med arealet ferdig utfylt.
        </p>
      </div>
    </section>
  );
}

export default function SettingsView() {
  const settings = useSettings();
  const update = useSettings((s) => s.update);
  const markAllSynced = useEntries((s) => s.markAllSynced);
  const entryCount = useEntries((s) => s.entries.length);
  const { configured, ready, account, login, logout } = useAuth();
  const { pendingCount, syncing, lastError, syncNow } = useSync();
  const toast = useToast();

  const [redirectUri, setRedirectUri] = useState('');
  useEffect(() => setRedirectUri(appRedirectUri()), []);

  function handleMarkAll() {
    if (!window.confirm('Merke alle registreringer som synkronisert? Bruk dette hvis Excel-filen allerede inneholder radene.')) return;
    markAllSynced();
    toast('Alt merket som synkronisert');
  }

  return (
    <div className="space-y-6">
      {/* Beregning */}
      <section className="space-y-3">
        <SectionHeader emoji="🧮" dot="bg-cyan">Beregning</SectionHeader>
        <div className="card space-y-4">
          <NumField
            label="Vekt per lass"
            suffix="tonn"
            value={settings.vektPerLass}
            onCommit={(n) => update({ vektPerLass: n })}
          />
          <NumField
            label="Fosforinnhold"
            suffix="kg P/tonn"
            value={settings.fosfor}
            onCommit={(n) => update({ fosfor: n })}
          />
          <NumField
            label="P-grense"
            suffix="kg P/daa"
            value={settings.pGrense}
            onCommit={(n) => update({ pGrense: n })}
          />
          <p className="text-xs text-muted">
            Forskriftens P-grenser: 3,5 (2026) · 2,8 (2027–2029) · 2,3 (fra 2033) kg P/daa.
          </p>
        </div>
      </section>

      <SkifterAdmin />

      {/* OneDrive */}
      <section className="space-y-3">
        <SectionHeader emoji="☁️" dot="bg-violet">OneDrive-tilkobling</SectionHeader>
        <div className="card space-y-4">
          <Field label="Azure Client ID">
            <input
              type="text"
              className="input-field font-mono text-sm"
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              value={settings.clientId}
              onChange={(e) => update({ clientId: e.target.value.trim() })}
            />
          </Field>
          <Field label="OneDrive fil-ID (Excel)">
            <input
              type="text"
              className="input-field font-mono text-sm"
              placeholder="Fil-ID fra Graph"
              autoComplete="off"
              value={settings.fileId}
              onChange={(e) => update({ fileId: e.target.value.trim() })}
            />
          </Field>
          <Field label="Arknavn">
            <input
              type="text"
              className="input-field"
              value={settings.sheetName}
              onChange={(e) => update({ sheetName: e.target.value })}
            />
          </Field>

          {redirectUri && (
            <p className="text-xs text-muted">
              Redirect-URI som må registreres i Azure (SPA-plattform):{' '}
              <span className="font-mono text-ink">{redirectUri}</span>
            </p>
          )}

          {!configured ? (
            <p className="text-xs text-muted">
              Legg inn Azure Client ID for å koble til OneDrive. Registreringer lagres uansett trygt
              lokalt.
            </p>
          ) : !ready ? (
            <p className="text-xs text-muted">Starter innlogging…</p>
          ) : account ? (
            <div className="space-y-3">
              <div className="text-sm">
                Tilkoblet som <span className="font-medium">{account.username}</span>
              </div>
              <button className="btn-secondary w-full" onClick={() => void logout()}>
                Logg ut
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => void login()}>
              Koble til OneDrive
            </button>
          )}
        </div>
      </section>

      {/* Synkronisering */}
      <section className="space-y-3">
        <SectionHeader emoji="🔄" dot="bg-warn">Synkronisering</SectionHeader>
        <div className="card space-y-3">
          <div className="text-sm">
            {entryCount} registreringer totalt ·{' '}
            {pendingCount > 0 ? (
              <span className="font-medium text-warn">{pendingCount} venter på synkronisering</span>
            ) : (
              <span className="text-muted">alt synkronisert</span>
            )}
          </div>
          {lastError && <div className="text-xs text-danger">Siste feil: {lastError}</div>}
          <button
            className="btn-secondary w-full"
            disabled={syncing || pendingCount === 0}
            onClick={() => void syncNow()}
          >
            {syncing ? 'Synkroniserer…' : 'Synkroniser nå'}
          </button>
          {pendingCount > 0 && (
            <button
              className="min-h-[44px] w-full text-xs text-muted active:text-ink"
              onClick={handleMarkAll}
            >
              Merk alt som synkronisert (hopp over Excel-skriving)
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
