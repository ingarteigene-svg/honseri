// Driftskommandoer mot produksjon i Cloudflare.
//
//   node scripts/prod.mjs deploy    → finn/opprett databasen, migrer, publiser butikk og admin
//   node scripts/prod.mjs backup    → full eksport av databasen til backup/<tidspunkt>.sql
//
// Innstillinger leses fra miljøvariabler, eller fra fila .env.prod (ligger i
// .gitignore og skal ALDRI inn i Git):
//   CLOUDFLARE_API_TOKEN                API-token (samme som Pallsporing/Hønseri), eller `npx wrangler login`
//   CLOUDFLARE_ACCOUNT_ID               Konto-ID
//   GARDSBUTIKK_D1_DATABASE_ID          Valgfri. Uten denne finnes databasen «gardsbutikk» etter navn,
//                                       eller den opprettes i Vest-Europa første gang.
//   ACCESS_TEAM_DOMAIN                  f.eks. klokkargarden.cloudflareaccess.com
//   GARDSBUTIKK_ACCESS_AUD              «Application Audience (AUD) Tag» for gardsbutikk-admin
//   GARDSBUTIKK_VIPPS_CLIENT_ID         Vipps-nøkler fra portal.vipps.no. Legges inn som
//   GARDSBUTIKK_VIPPS_CLIENT_SECRET     hemmeligheter i begge Workers. Mangler de, beholdes
//   GARDSBUTIKK_VIPPS_SUBSCRIPTION_KEY  det som allerede ligger i Cloudflare.
//   GARDSBUTIKK_VIPPS_MSN
//   GARDSBUTIKK_VIPPS_ENV               test (standard) eller prod

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const DB_NAME = 'gardsbutikk';
const SHOP = 'gardsbutikk';
const ADMIN = 'gardsbutikk-admin';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KEYS = [
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GARDSBUTIKK_D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'GARDSBUTIKK_ACCESS_AUD',
  'GARDSBUTIKK_VIPPS_CLIENT_ID', 'GARDSBUTIKK_VIPPS_CLIENT_SECRET', 'GARDSBUTIKK_VIPPS_SUBSCRIPTION_KEY', 'GARDSBUTIKK_VIPPS_MSN',
  'GARDSBUTIKK_VIPPS_ENV',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.prod');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
// Fjern mellomrom/linjeskift som lett følger med ved kopiering av verdier.
for (const k of KEYS) if (process.env[k] != null) process.env[k] = process.env[k].trim();

const cmd = process.argv[2];
if (!['deploy', 'backup'].includes(cmd)) {
  console.error('Bruk: node scripts/prod.mjs deploy|backup');
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function wrangler(args, { capture = false } = {}) {
  return execFileSync(npx, ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
}

/** Finn ID-en til databasen «gardsbutikk», eller opprett den. */
function databaseId() {
  const given = process.env.GARDSBUTIKK_D1_DATABASE_ID;
  if (given) {
    if (!UUID.test(given) || given.length !== 36) {
      console.error('GARDSBUTIKK_D1_DATABASE_ID ser ikke riktig ut (ventet format 1a2b3c4d-5e6f-…).');
      process.exit(1);
    }
    return given;
  }
  const list = JSON.parse(wrangler(['d1', 'list', '--json'], { capture: true }));
  const found = list.find((d) => d.name === DB_NAME);
  if (found) return found.uuid;
  console.log(`\nDatabasen «${DB_NAME}» finnes ikke – oppretter den i Vest-Europa …`);
  const out = wrangler(['d1', 'create', DB_NAME, '--location', 'weur'], { capture: true });
  const id = out.match(UUID)?.[0];
  if (!id) {
    console.error('Klarte ikke å lese ID-en til den nye databasen:\n' + out);
    process.exit(1);
  }
  console.log(`Opprettet databasen «${DB_NAME}» (${id}).`);
  return id;
}

function replaceOnce(text, pattern, replacement, what) {
  const out = text.replace(pattern, replacement);
  if (out === text) {
    console.error(`Fant ikke ${what} i wrangler.toml.`);
    process.exit(1);
  }
  return out;
}

// Midlertidige konfigurasjoner med ekte database-ID (skrives aldri til Git).
const dbId = databaseId();
const template = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const shopToml = replaceOnce(template, /^database_id = "SETTES_VED_DEPLOY"$/m, `database_id = "${dbId}"`, 'linja database_id = "SETTES_VED_DEPLOY"');
let adminToml = replaceOnce(shopToml, /^name = "gardsbutikk"$/m, `name = "${ADMIN}"`, `name = "${SHOP}"`);
adminToml = replaceOnce(adminToml, /^ROLE = "butikk"$/m, 'ROLE = "admin"', 'ROLE = "butikk"');
adminToml = replaceOnce(adminToml, /^\[triggers\]\ncrons = .*$/m, '', 'cron-blokka');
writeFileSync(join(root, 'wrangler.prod.toml'), shopToml);
writeFileSync(join(root, 'wrangler.admin.toml'), adminToml);
const withConfig = (config, ...args) => wrangler([...args, '--config', config]);

let secretsFile = null;
try {
  if (cmd === 'deploy') {
    const team = process.env.ACCESS_TEAM_DOMAIN;
    const aud = process.env.GARDSBUTIKK_ACCESS_AUD;
    const vippsEnv = process.env.GARDSBUTIKK_VIPPS_ENV === 'prod' ? 'prod' : 'test';

    withConfig('wrangler.prod.toml', 'd1', 'migrations', 'apply', 'DB', '--remote');

    // Butikken: åpen for alle, trenger ikke Access.
    withConfig('wrangler.prod.toml', 'deploy', '--var', `VIPPS_ENV:${vippsEnv}`);

    // Adminsiden: avviser alt til Access er satt opp (fail closed).
    const adminVars = ['--var', `VIPPS_ENV:${vippsEnv}`];
    if (team && aud) adminVars.push('--var', `ACCESS_TEAM_DOMAIN:${team}`, '--var', `ACCESS_AUD:${aud}`);
    else console.warn('\nACCESS_TEAM_DOMAIN/GARDSBUTIKK_ACCESS_AUD mangler – adminsiden publiseres, men avviser alle til Access er satt opp (se README).\n');
    withConfig('wrangler.admin.toml', 'deploy', ...adminVars);

    const secrets = {
      VIPPS_CLIENT_ID: process.env.GARDSBUTIKK_VIPPS_CLIENT_ID,
      VIPPS_CLIENT_SECRET: process.env.GARDSBUTIKK_VIPPS_CLIENT_SECRET,
      VIPPS_SUBSCRIPTION_KEY: process.env.GARDSBUTIKK_VIPPS_SUBSCRIPTION_KEY,
      VIPPS_MSN: process.env.GARDSBUTIKK_VIPPS_MSN,
    };
    const given = Object.values(secrets).filter(Boolean).length;
    if (given === 4) {
      secretsFile = join(tmpdir(), `vipps-secrets-${randomBytes(6).toString('hex')}.json`);
      writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
      withConfig('wrangler.prod.toml', 'secret', 'bulk', secretsFile);
      withConfig('wrangler.admin.toml', 'secret', 'bulk', secretsFile);
      console.log(`\nVipps-nøkler lagt inn i begge Workers (miljø: ${vippsEnv}).`);
    } else if (given > 0) {
      console.error('\nBare noen av Vipps-nøklene er lagt inn. Alle fire trengs: CLIENT_ID, CLIENT_SECRET, SUBSCRIPTION_KEY og MSN.');
      process.exitCode = 1;
    } else {
      console.log('\nIngen Vipps-nøkler i oppsettet – beholder det som ligger i Cloudflare (butikken tar bare kontant til nøklene er på plass).');
    }
  } else {
    const dir = join(root, 'backup');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const out = `backup/gardsbutikk-${stamp}.sql`;
    withConfig('wrangler.prod.toml', 'd1', 'export', 'DB', '--remote', '--output', out);
    console.log(`\nSikkerhetskopi lagret: ${join(root, out)}\nFlytt/kopier den til et trygt sted (f.eks. OneDrive), ikke til GitHub.`);
  }
} finally {
  if (secretsFile) rmSync(secretsFile, { force: true });
  rmSync(join(root, 'wrangler.prod.toml'), { force: true });
  rmSync(join(root, 'wrangler.admin.toml'), { force: true });
}
