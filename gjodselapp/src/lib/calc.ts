import { CalcSettings, Entry, Status } from './types';

// Standardverdier iht. gjødselbrukforskriften og utstyret på garden.
// P-grense: 3,5 (2026), 2,8 (2027–2029), 2,3 (fra 2033) kg P/daa.
export const DEFAULT_CALC: CalcSettings = {
  vektPerLass: 6.5,
  fosfor: 5.0,
  pGrense: 3.5,
};

export function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Beregner mengde og fosfor for én levering. */
export function calcDelivery(lass: number, areal: number, s: CalcSettings) {
  const totalTonn = round(lass * s.vektPerLass, 2);
  const kgPerDaa = areal > 0 ? round((totalTonn * 1000) / areal, 1) : 0;
  const pPerDaa = areal > 0 ? round((totalTonn * s.fosfor) / areal, 2) : 0;
  return { totalTonn, kgPerDaa, pPerDaa };
}

/**
 * Status vurderes mot AKKUMULERT P-belastning på skiftet i sesongen
 * (kalenderåret) – flere leveringer på samme skifte teller sammen.
 */
export function statusFor(accumulatedP: number, grense: number): Status {
  if (accumulatedP > grense) return 'OVER GRENSE';
  if (accumulatedP >= 0.9 * grense) return 'NÆR GRENSE';
  return 'OK';
}

/** Sum tilført P (kg/daa) på et skifte i et gitt år. */
export function accumulatedP(entries: Entry[], skifte: string, year: string): number {
  return round(
    entries
      .filter((e) => e.skifte === skifte && e.dato.startsWith(year))
      .reduce((sum, e) => sum + e.pPerDaa, 0),
    2,
  );
}
