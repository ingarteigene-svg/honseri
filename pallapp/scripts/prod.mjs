// Driftskommandoer mot produksjonsdatabasen i Cloudflare.
//
//   node scripts/prod.mjs deploy    → databasemigreringer + publisering av appen
//   node scripts/prod.mjs backup    → full eksport av databasen til backup/<tidspunkt>.sql
//
// Innstillinger leses fra miljøvariabler, eller fra filen .env.prod (ligger i
// .gitignore og skal ALDRI inn i Git):
//   CLOUDFLARE_API_TOKEN   API-token (eller kjør `npx wrangler login` én gang på PC-en)
//   CLOUDFLARE_ACCOUNT_ID  Konto-ID
//   D1_DATABASE_ID         ID-en til D1-databasen «pallsporing»
//   ACCESS_TEAM_DOMAIN     f.eks. klokkargarden.cloudflareaccess.com   (deploy)
//   ACCESS_AUD             «Application Audience (AUD) Tag» fra Access   (deploy)

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.prod');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Fjern mellomrom/linjeskift som lett følger med ved kopiering av verdier.
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
  if (process.env[k] != null) process.env[k] = process.env[k].trim();
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Mangler ${name}. Sett den som miljøvariabel eller i pallapp/.env.prod (se README).`);
    process.exit(1);
  }
  return v;
}

const cmd = process.argv[2];
if (!['deploy', 'backup'].includes(cmd)) {
  console.error('Bruk: node scripts/prod.mjs deploy|backup');
  process.exit(1);
}

// Midlertidig konfigurasjon med ekte database-ID (skrives aldri til Git).
const dbId = need('D1_DATABASE_ID');
const prodConfig = join(root, 'wrangler.prod.toml');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dbId)) {
  console.error('D1_DATABASE_ID ser ikke riktig ut (forventet format 1a2b3c4d-5e6f-…). Kopier «Database ID» fra Cloudflare på nytt.');
  process.exit(1);
}
const template = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const configured = template.replace(/^database_id = "SETTES_VED_DEPLOY"$/m, `database_id = "${dbId}"`);
if (configured === template) {
  console.error('Fant ikke linjen database_id = "SETTES_VED_DEPLOY" i wrangler.toml.');
  process.exit(1);
}
writeFileSync(prodConfig, configured);

const wrangler = (...args) =>
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args, '--config', 'wrangler.prod.toml'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

try {
  if (cmd === 'deploy') {
    const team = process.env.ACCESS_TEAM_DOMAIN;
    const aud = process.env.ACCESS_AUD;
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote');
    if (team && aud) {
      wrangler('deploy', '--var', `ACCESS_TEAM_DOMAIN:${team}`, '--var', `ACCESS_AUD:${aud}`);
    } else {
      // Første publisering: Access kan først slås på når Workeren finnes.
      // Uten disse verdiene avviser appen alle forespørsler (fail closed).
      console.warn('\nACCESS_TEAM_DOMAIN/ACCESS_AUD mangler – appen publiseres, men avviser alle til Access er satt opp.\n');
      wrangler('deploy');
    }
  } else {
    const dir = join(root, 'backup');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const out = `backup/pallsporing-${stamp}.sql`; // relativ sti: tåler mellomrom i mappenavn på Windows
    wrangler('d1', 'export', 'DB', '--remote', '--output', out);
    console.log(`\nSikkerhetskopi lagret: ${join(root, out)}\nFlytt/kopier den til et sikkert sted (f.eks. OneDrive), ikke til GitHub.`);
  }
} finally {
  rmSync(prodConfig, { force: true });
}
