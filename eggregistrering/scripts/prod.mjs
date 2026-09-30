// Driftskommandoar mot produksjon i Cloudflare.
//
//   node scripts/prod.mjs deploy    → finn/opprett databasen, migrer, publiser appen
//   node scripts/prod.mjs backup    → full eksport av databasen til backup/<tidspunkt>.sql
//
// Innstillingar blir lesne frå miljøvariablar, eller frå fila .env.prod (ligg i
// .gitignore og skal ALDRI inn i Git):
//   CLOUDFLARE_API_TOKEN     API-token (same som Pallsporing brukar), eller `npx wrangler login`
//   CLOUDFLARE_ACCOUNT_ID    Konto-ID
//   HONSERI_D1_DATABASE_ID   Valfri. Utan denne blir databasen «honseri» funnen,
//                            eller oppretta i Vest-Europa første gong.
//   ACCESS_TEAM_DOMAIN       t.d. klokkargarden.cloudflareaccess.com (same team som Pallsporing)
//   HONSERI_ACCESS_AUD       «Application Audience (AUD) Tag» for Hønseri-applikasjonen i Access

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_NAME = 'honseri';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.prod');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
// Fjern mellomrom/linjeskift som lett følgjer med ved kopiering av verdiar.
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'HONSERI_D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'HONSERI_ACCESS_AUD']) {
  if (process.env[k] != null) process.env[k] = process.env[k].trim();
}

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

/** Finn ID-en til databasen «honseri», eller opprett han. */
function databaseId() {
  const given = process.env.HONSERI_D1_DATABASE_ID;
  if (given) {
    if (!UUID.test(given) || given.length !== 36) {
      console.error('HONSERI_D1_DATABASE_ID ser ikkje rett ut (venta format 1a2b3c4d-5e6f-…).');
      process.exit(1);
    }
    return given;
  }
  const list = JSON.parse(wrangler(['d1', 'list', '--json'], { capture: true }));
  const found = list.find((d) => d.name === DB_NAME);
  if (found) return found.uuid;
  console.log(`\nDatabasen «${DB_NAME}» finst ikkje – opprettar han i Vest-Europa …`);
  const out = wrangler(['d1', 'create', DB_NAME, '--location', 'weur'], { capture: true });
  const id = out.match(UUID)?.[0];
  if (!id) {
    console.error('Klarte ikkje å lese ID-en til den nye databasen:\n' + out);
    process.exit(1);
  }
  console.log(`Oppretta databasen «${DB_NAME}» (${id}).`);
  return id;
}

// Mellombels konfigurasjon med ekte database-ID (blir aldri skriven til Git).
const dbId = databaseId();
const prodConfig = join(root, 'wrangler.prod.toml');
const template = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const configured = template.replace(/^database_id = "SETTES_VED_DEPLOY"$/m, `database_id = "${dbId}"`);
if (configured === template) {
  console.error('Fann ikkje linja database_id = "SETTES_VED_DEPLOY" i wrangler.toml.');
  process.exit(1);
}
writeFileSync(prodConfig, configured);
const prod = (...args) => wrangler([...args, '--config', 'wrangler.prod.toml']);

try {
  if (cmd === 'deploy') {
    const team = process.env.ACCESS_TEAM_DOMAIN;
    const aud = process.env.HONSERI_ACCESS_AUD;
    prod('d1', 'migrations', 'apply', 'DB', '--remote');
    if (team && aud) {
      prod('deploy', '--var', `ACCESS_TEAM_DOMAIN:${team}`, '--var', `ACCESS_AUD:${aud}`);
    } else {
      // Første publisering: Access kan først slåast på når Workeren finst.
      // Utan desse verdiane avviser appen alle førespurnader til data (fail closed).
      console.warn('\nACCESS_TEAM_DOMAIN/HONSERI_ACCESS_AUD manglar – appen blir publisert, men avviser alle til Access er sett opp (sjå README).\n');
      prod('deploy');
    }
  } else {
    const dir = join(root, 'backup');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const out = `backup/honseri-${stamp}.sql`;
    prod('d1', 'export', 'DB', '--remote', '--output', out);
    console.log(`\nSikkerheitskopi lagra: ${join(root, out)}\nFlytt/kopier ho til ein trygg stad (t.d. OneDrive), ikkje til GitHub.`);
  }
} finally {
  rmSync(prodConfig, { force: true });
}
