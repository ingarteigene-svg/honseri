/** Unik ID for registreringer og skifter. */
export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Dagens dato i lokal tid som yyyy-mm-dd. */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** yyyy-mm-dd → dd.mm.yyyy */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Norsk tallformat, maks to desimaler. */
export function fmtNum(n: number): string {
  return n.toLocaleString('nb-NO', { maximumFractionDigits: 2 });
}
