// Bygger den publiserbare appen til dist/:
//   * kopierer public/
//   * kopierer MSAL.js (Microsoft-innlogging) fra node_modules
//   * skriver config.js fra miljøvariabler (GitHub → Settings → Variables):
//       PALL_CLIENT_ID  Application (client) ID fra app-registreringen i Entra ID
//       PALL_TENANT_ID  Directory (tenant) ID for gårdens Microsoft 365
//       PALL_FILE_URL   Delingslenke til Excel-filen i OneDrive for Business / SharePoint
// Ingen av verdiene er hemmelige (de gir ingen tilgang uten innlogging), men de
// ligger likevel ikke i koden.

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'public'), dist, {
  recursive: true,
  filter: (src) => !src.endsWith('config.js') && !src.includes(`${join('public', 'vendor')}`),
});

const msal = join(root, 'node_modules', '@azure', 'msal-browser', 'lib', 'msal-browser.min.js');
if (!existsSync(msal)) {
  console.error('Fant ikke MSAL.js – kjør «npm ci» først.');
  process.exit(1);
}
mkdirSync(join(dist, 'vendor'), { recursive: true });
cpSync(msal, join(dist, 'vendor', 'msal-browser.min.js'));

const config = {
  clientId: process.env.PALL_CLIENT_ID || '',
  tenantId: process.env.PALL_TENANT_ID || '',
  fileUrl: process.env.PALL_FILE_URL || '',
};
writeFileSync(join(dist, 'config.js'), `window.PALL_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
const missing = Object.entries(config).filter(([, v]) => !v).map(([k]) => k);
console.log(missing.length
  ? `dist/ bygget, men mangler innstillinger: ${missing.join(', ')} – appen viser «ikke satt opp».`
  : 'dist/ bygget med fullstendige innstillinger.');
