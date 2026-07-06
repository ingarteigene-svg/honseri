import { calcDelivery, statusFor, accumulatedP, round, DEFAULT_CALC } from './calc';
import { Entry } from './types';

// Eksisterende leveringer fra spredesesongen 2026 (forhåndslastet).
const RAW: Array<{ dato: string; skifte: string; mottaker: string; lass: number; areal: number }> = [
  { dato: '2026-04-15', skifte: 'Elvane', mottaker: '', lass: 3, areal: 40 },
  { dato: '2026-04-15', skifte: 'Arve Dimmen', mottaker: '', lass: 2, areal: 17 },
  { dato: '2026-04-15', skifte: 'Bakkane, over', mottaker: '', lass: 1, areal: 9 },
  { dato: '2026-04-15', skifte: 'Rune Holstad', mottaker: '', lass: 1, areal: 10 },
  { dato: '2026-04-16', skifte: 'Joar, nytt', mottaker: '', lass: 3, areal: 40 },
  { dato: '2026-04-16', skifte: 'Håvard, over veien', mottaker: '', lass: 3, areal: 25 },
  { dato: '2026-04-16', skifte: 'Håvard, Måseide', mottaker: '', lass: 3, areal: 40 },
  { dato: '2026-04-16', skifte: 'Håvard, nedom 1', mottaker: '', lass: 1, areal: 10 },
  { dato: '2026-04-16', skifte: 'Håvard, nedom 2', mottaker: '', lass: 1, areal: 10 },
  { dato: '2026-04-16', skifte: 'Håvard, nedom 3', mottaker: '', lass: 1, areal: 10 },
  { dato: '2026-04-16', skifte: 'Joar, start Kvithol', mottaker: '', lass: 2, areal: 15 },
  { dato: '2026-04-16', skifte: 'Geir, nabojord mot H', mottaker: '', lass: 2, areal: 15 },
];

/** Bygger de forhåndslastede registreringene med standard beregningsverdier. */
export function buildSeedEntries(): Entry[] {
  const entries: Entry[] = [];
  RAW.forEach((r, i) => {
    const c = calcDelivery(r.lass, r.areal, DEFAULT_CALC);
    const year = r.dato.slice(0, 4);
    const acc = round(accumulatedP(entries, r.skifte, year) + c.pPerDaa, 2);
    entries.push({
      id: `seed-${i + 1}`,
      ...r,
      ...c,
      status: statusFor(acc, DEFAULT_CALC.pGrense),
      synced: false,
    });
  });
  return entries;
}
