// Innlogging via Cloudflare Access (same løysing som Pallsporing, men eigen kopi og eiga Access-applikasjon).
//
// Access står foran hele Workeren og slipper bare inn godkjente e-postadresser
// (policy i Cloudflare Zero Trust). Workeren verifiserer i tillegg Access-tokenet
// (JWT, RS256) mot teamets offentlige nøkler, slik at ingen kan omgå Access ved å
// sende en falsk header. Mangler oppsettet, avvises alle forespørsler (fail closed).

let certCache = { url: null, keys: null, fetchedAt: 0 };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getKeys(teamDomain, forceRefresh = false) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = Date.now() - certCache.fetchedAt < 60 * 60 * 1000;
  if (!forceRefresh && certCache.url === url && certCache.keys && fresh) return certCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kunne ikke hente Access-nøkler (${res.status})`);
  const { keys } = await res.json();
  certCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

async function verifyJwt(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Ugyldig token');
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Ugyldig algoritme');

  let keys = await getKeys(teamDomain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(teamDomain, true); // nøkkelrotasjon
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('Ukjent nøkkel');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('Ugyldig signatur');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Token utløpt');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('Feil applikasjon (aud)');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('Feil utsteder');
  if (!payload.email) throw new Error('Token mangler e-post');
  return String(payload.email).toLowerCase();
}

function isLocal(request) {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/** Returnerer e-postadressen til innlogget bruker, eller null. */
/**
 * Som authenticate, men returnerer også grunnen når innlogginga blir avvist.
 * Grunnen inneheld ingen hemmelegheiter, berre kva som ikkje stemde, slik at
 * feil oppsett (t.d. feil AUD-tag eller teamdomene) er lett å finne.
 */
export async function authenticateWithReason(request, env) {
  // Lokal utvikling/test: DEV_USER settes bare i .dev.vars (ikke i Git, ikke i produksjon)
  // og virker kun på localhost.
  if (env.DEV_USER && isLocal(request)) {
    return { user: (request.headers.get('X-Dev-User') || env.DEV_USER).toLowerCase() };
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) {
    throw Object.assign(new Error('Innlogging er ikke konfigurert (ACCESS_TEAM_DOMAIN/ACCESS_AUD mangler).'), {
      status: 500,
    });
  }

  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (m) token = m[1];
  }
  if (!token) return { user: null, reason: 'Ingen innloggingsbillett fra Cloudflare Access i forespørselen' };
  const team = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    return { user: await verifyJwt(token, team, aud) };
  } catch (e) {
    let detail = '';
    try {
      const p = b64urlJson(token.split('.')[1]);
      const short = (s) => String(s || '').slice(0, 8);
      if (/aud/.test(e.message)) {
        const got = (Array.isArray(p.aud) ? p.aud : [p.aud]).map(short).join(', ');
        detail = ` (billetten gjelder ${got}…, appen venter ${short(aud)}…)`;
      } else if (/utsteder/.test(e.message)) {
        detail = ` (billetten er fra ${p.iss}, appen venter https://${team})`;
      }
    } catch { /* ugyldig token */ }
    return { user: null, reason: e.message + detail };
  }
}

/** Returnerer e-postadressen til innlogget bruker, eller null. */
export async function authenticate(request, env) {
  return (await authenticateWithReason(request, env)).user;
}
