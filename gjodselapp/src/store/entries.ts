import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Entry } from '@/lib/types';
import { buildSeedEntries } from '@/lib/seed';

interface EntriesState {
  entries: Entry[];
  seeded: boolean;
  add: (entry: Entry) => void;
  remove: (id: string) => void;
  markSynced: (id: string) => void;
  markAllSynced: () => void;
  /** Laster de forhåndsdefinerte 2026-leveringene ved første oppstart. */
  seedIfEmpty: () => void;
}

export const useEntries = create<EntriesState>()(
  persist(
    (set, get) => ({
      entries: [],
      seeded: false,
      add: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      markSynced: (id) =>
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, synced: true } : e)),
        })),
      markAllSynced: () => set((s) => ({ entries: s.entries.map((e) => ({ ...e, synced: true })) })),
      seedIfEmpty: () => {
        const s = get();
        if (!s.seeded && s.entries.length === 0) {
          set({ entries: buildSeedEntries(), seeded: true });
        }
      },
    }),
    { name: 'gjodsel-entries' },
  ),
);
