import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newId } from '@/lib/format';

export interface Skifte {
  id: string;
  navn: string;
  areal: number; // daa
}

interface SkifterState {
  skifter: Skifte[];
  seeded: boolean;
  add: (navn: string, areal: number) => void;
  update: (id: string, patch: Partial<Pick<Skifte, 'navn' | 'areal'>>) => void;
  remove: (id: string) => void;
  /** Bygger skiftelista fra eksisterende registreringer ved første oppstart. */
  seedFrom: (pairs: Array<{ navn: string; areal: number }>) => void;
}

export const useSkifter = create<SkifterState>()(
  persist(
    (set, get) => ({
      skifter: [],
      seeded: false,
      add: (navn, areal) =>
        set((s) => ({ skifter: [...s.skifter, { id: newId(), navn, areal }] })),
      update: (id, patch) =>
        set((s) => ({ skifter: s.skifter.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      remove: (id) => set((s) => ({ skifter: s.skifter.filter((x) => x.id !== id) })),
      seedFrom: (pairs) => {
        if (get().seeded) return;
        // Siste registrerte areal per skiftenavn vinner
        const map = new Map<string, number>();
        pairs.forEach((p) => {
          if (p.navn) map.set(p.navn, p.areal);
        });
        set({
          skifter: [...map.entries()].map(([navn, areal]) => ({ id: newId(), navn, areal })),
          seeded: true,
        });
      },
    }),
    { name: 'gjodsel-skifter' },
  ),
);
