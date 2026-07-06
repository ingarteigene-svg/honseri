'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { getMsal, GRAPH_SCOPES } from '@/lib/msal';
import { appendJournalRow, entryToRow } from '@/lib/graph';
import { useSettings } from '@/store/settings';
import { useEntries } from '@/store/entries';
import { useSkifter } from '@/store/skifter';
import { ToastProvider } from './Toast';
import SwRegister from './SwRegister';

/* ---------- Auth-kontekst ---------- */

interface AuthCtxValue {
  configured: boolean; // Azure Client ID er satt
  ready: boolean; // handleRedirectPromise er ferdig
  account: AccountInfo | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthCtx = createContext<AuthCtxValue>({
  configured: false,
  ready: false,
  account: null,
  login: async () => {},
  logout: async () => {},
  getToken: async () => null,
});

export const useAuth = () => useContext(AuthCtx);

/* ---------- Sync-kontekst ---------- */

interface SyncCtxValue {
  pendingCount: number;
  syncing: boolean;
  lastError: string | null;
  syncNow: () => Promise<void>;
}

const SyncCtx = createContext<SyncCtxValue>({
  pendingCount: 0,
  syncing: false,
  lastError: null,
  syncNow: async () => {},
});

export const useSync = () => useContext(SyncCtx);

/* ---------- Provider ---------- */

export default function Providers({ children }: { children: React.ReactNode }) {
  const clientId = useSettings((s) => s.clientId);
  const seedIfEmpty = useEntries((s) => s.seedIfEmpty);
  const pendingCount = useEntries((s) => s.entries.filter((e) => !e.synced).length);

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const busy = useRef(false);

  // Forhåndslast 2026-dataene og bygg skiftelista ved første oppstart
  useEffect(() => {
    seedIfEmpty();
    const sk = useSkifter.getState();
    if (!sk.seeded) {
      sk.seedFrom(
        useEntries.getState().entries.map((e) => ({ navn: e.skifte, areal: e.areal })),
      );
    }
  }, [seedIfEmpty]);

  // Init MSAL og fang opp svar fra redirect-innlogging
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clientId) {
        setAccount(null);
        setReady(true);
        return;
      }
      try {
        const msal = await getMsal(clientId);
        const result = await msal.handleRedirectPromise();
        if (result?.account) msal.setActiveAccount(result.account);
        const acc = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
        if (acc) msal.setActiveAccount(acc);
        if (!cancelled) setAccount(acc);
      } catch {
        if (!cancelled) setAccount(null);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const login = useCallback(async () => {
    if (!clientId) return;
    const msal = await getMsal(clientId);
    await msal.loginRedirect({ scopes: GRAPH_SCOPES });
  }, [clientId]);

  const logout = useCallback(async () => {
    if (!clientId) return;
    const msal = await getMsal(clientId);
    await msal.logoutRedirect();
  }, [clientId]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!clientId) return null;
    const msal = await getMsal(clientId);
    const acc = msal.getActiveAccount();
    if (!acc) return null;
    try {
      // MSAL validerer utløpstid og fornyer tokenet automatisk
      const res = await msal.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: acc });
      return res.accessToken;
    } catch {
      await msal.acquireTokenRedirect({ scopes: GRAPH_SCOPES });
      return null;
    }
  }, [clientId]);

  /** Skriver alle ventende registreringer til Excel, eldste først. */
  const syncNow = useCallback(async () => {
    if (busy.current || typeof navigator === 'undefined' || !navigator.onLine) return;
    const { fileId, sheetName } = useSettings.getState();
    if (!account || !fileId) return;

    busy.current = true;
    setSyncing(true);
    setLastError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const pending = useEntries
        .getState()
        .entries.filter((e) => !e.synced)
        .sort((a, b) => a.dato.localeCompare(b.dato) || a.id.localeCompare(b.id));
      for (const entry of pending) {
        await appendJournalRow(token, fileId, sheetName, entryToRow(entry));
        useEntries.getState().markSynced(entry.id);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Ukjent feil ved synkronisering');
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [account, getToken]);

  // Auto-sync ved innlogging/oppstart med gyldig konto
  useEffect(() => {
    if (account && pendingCount > 0) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Auto-sync når nettet kommer tilbake
  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncNow]);

  return (
    <AuthCtx.Provider value={{ configured: Boolean(clientId), ready, account, login, logout, getToken }}>
      <SyncCtx.Provider value={{ pendingCount, syncing, lastError, syncNow }}>
        <ToastProvider>
          <SwRegister />
          {children}
        </ToastProvider>
      </SyncCtx.Provider>
    </AuthCtx.Provider>
  );
}
