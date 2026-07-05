export type Status = 'OK' | 'NÆR GRENSE' | 'OVER GRENSE';

export interface Entry {
  id: string;
  dato: string; // yyyy-mm-dd
  skifte: string;
  mottaker: string;
  lass: number;
  areal: number; // daa
  // Beregnet ved lagring (øyeblikksbilde av innstillingene)
  totalTonn: number;
  kgPerDaa: number;
  pPerDaa: number; // tilført fosfor, kg P/daa
  status: Status;
  // Synkronisering mot Excel/OneDrive
  synced: boolean;
}

export interface CalcSettings {
  vektPerLass: number; // tonn per lass (Ktwo Duo 600 Mk5: 6,5 t)
  fosfor: number; // kg P per tonn gjødsel
  pGrense: number; // kg P/daa (3,5 i 2026)
}
