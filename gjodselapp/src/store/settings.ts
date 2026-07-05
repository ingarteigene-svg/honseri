import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CALC } from '@/lib/calc';

export interface SettingsState {
  // Beregning
  vektPerLass: number;
  fosfor: number;
  pGrense: number;
  // OneDrive / Microsoft Graph
  clientId: string;
  fileId: string;
  sheetName: string;
  update: (patch: Partial<Omit<SettingsState, 'update'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_CALC,
      clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
      fileId: process.env.NEXT_PUBLIC_ONEDRIVE_FILE_ID ?? '',
      sheetName: 'Spredejournal',
      update: (patch) => set(patch),
    }),
    { name: 'gjodsel-settings' },
  ),
);
