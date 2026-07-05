import { Entry } from './types';
import { formatDate } from './format';

const GRAPH = 'https://graph.microsoft.com/v1.0';

function headers(token: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

/** Excel-kolonnene A–H i Spredejournal-arket. */
export function entryToRow(e: Entry): (string | number)[] {
  return [
    formatDate(e.dato), // A Dato (dd.mm.yyyy)
    e.skifte, //           B Skifte
    e.mottaker, //          C Mottaker
    e.lass, //              D Antall lass
    e.totalTonn, //         E Total mengde (t)
    e.kgPerDaa, //          F Mengde (kg/daa)
    e.pPerDaa, //           G Tilført P (kg/daa)
    e.status, //            H Status
  ];
}

/**
 * Legger til én rad i journalarket. Bruker første Excel-tabell i arket
 * hvis den finnes, ellers appendes raden rett under usedRange.
 */
export async function appendJournalRow(
  token: string,
  fileId: string,
  sheet: string,
  values: (string | number)[],
): Promise<void> {
  const base = `${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/workbook/worksheets/${encodeURIComponent(sheet)}`;

  // 1) Excel-tabell hvis arket har en
  const tablesRes = await fetch(`${base}/tables`, { headers: headers(token) });
  if (tablesRes.ok) {
    const tables: { id: string }[] = (await tablesRes.json()).value ?? [];
    if (tables.length > 0) {
      const res = await fetch(`${base}/tables/${tables[0].id}/rows`, {
        method: 'POST',
        headers: headers(token, true),
        body: JSON.stringify({ values: [values] }),
      });
      if (!res.ok) throw new Error(`Klarte ikke å legge til rad i tabellen (${res.status})`);
      return;
    }
  }

  // 2) Fallback: finn neste ledige rad via usedRange
  const urRes = await fetch(`${base}/usedRange(valuesOnly=true)?$select=address,rowCount`, {
    headers: headers(token),
  });
  if (!urRes.ok) throw new Error(`Fant ikke arket «${sheet}» (${urRes.status})`);
  const ur = (await urRes.json()) as { address: string; rowCount: number };
  const startRow = parseInt(ur.address.match(/[A-Z]+(\d+)/)?.[1] ?? '1', 10);
  const nextRow = startRow + ur.rowCount;

  const res = await fetch(`${base}/range(address='A${nextRow}:H${nextRow}')`, {
    method: 'PATCH',
    headers: headers(token, true),
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) throw new Error(`Klarte ikke å skrive rad til arket (${res.status})`);
}
