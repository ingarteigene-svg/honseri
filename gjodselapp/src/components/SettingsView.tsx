'use client';

import { useEffect, useState } from 'react';
import { useEntries } from '@/store/entries';
import { useSettings } from '@/store/settings';
import { useAuth, useSync } from './Providers';
import { useToast } from './Toast';
import { Field } from './ui';

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

export default function SettingsView() {
  const settings = useSettings();
  const update = useSettings((s) => s.update);
  const markAllSynced = useEntries((s) => s.markAllSynced);
  const entryCount = useEntries((s) => s.entries.length);
  const { configured, ready, account, login, logout } = useAuth();
  const { pendingCount, syncing, lastError, syncNow } = useSync();
  const toast = useToast();

  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  function handleMarkAll() {
    if (!window.confirm('Merke alle registreringer som synkronisert? Bruk dette hvis Excel-filen allerede inneholder radene.')) return;
    markAllSynced();
    toast('Alt merket som synkronisert');
  }

  return (
    <div className="space-y-6">
      {/* Beregning */}
      <section className="space-y-3">
        <h2 className="form-label">Beregning</h2>
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

      {/* OneDrive */}
      <section className="space-y-3">
        <h2 className="form-label">OneDrive-tilkobling</h2>
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

          {origin && (
            <p className="text-xs text-muted">
              Redirect-URI som må registreres i Azure (SPA-plattform):{' '}
              <span className="font-mono text-ink">{origin}</span>
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
        <h2 className="form-label">Synkronisering</h2>
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
