# Gjødseljournal – Klokkargarden

Mobil-PWA for registrering og dokumentasjon av hønsegjødselleveringer på Klokkargarden, Hareid.
Appen tilfredsstiller journalkravene i gjødselbrukforskriften (§ 27) og skriver hver levering som
en rad til en Excel-fil i OneDrive via Microsoft Graph API.

Bygget med **Next.js 14 (App Router)**, **Tailwind CSS**, **MSAL.js** (`@azure/msal-browser`)
og **Zustand** (lokal lagring i `localStorage`).

## Funksjoner

- **Registrer** – feltskjema med dato, skiftenavn (autocomplete fra tidligere leveringer,
  arealet fylles inn automatisk), mottaker og antall lass. Live-forhåndsvisning av beregningene
  og akkumulert P-belastning før du lagrer. Haptisk kvittering ved lagring.
- **Logg** – alle registreringer med status (OK / NÆR GRENSE / OVER GRENSE) og
  sync-status (Synkronisert / Venter).
- **Per skifte** – akkumulert fosforbelastning per skifte med progressbar mot P-grensen, per år.
- **Innstillinger** – beregningsparametre, Azure/OneDrive-oppsett og manuell synkronisering.
- **Offline først** – alt lagres lokalt umiddelbart; ventende rader synkroniseres automatisk ved
  oppstart med gyldig innlogging og når nettet kommer tilbake. Service worker cacher app-shell.
- **Mørk modus**, safe areas for iPhone (notch/Dynamic Island), min. 44 px touch-mål,
  respekterer `prefers-reduced-motion`.

## Beregningslogikk

```
Total mengde (t)    = antall lass × vekt per lass        (standard 6,5 t – Ktwo Duo 600 Mk5)
Mengde (kg/daa)     = total mengde × 1000 / areal
Tilført P (kg/daa)  = total mengde × fosforinnhold / areal   (standard 5,0 kg P/t)
Status              = OK | NÆR GRENSE (≥ 90 %) | OVER GRENSE
```

Status vurderes mot **akkumulert** P-belastning på skiftet i kalenderåret – flere leveringer på
samme skifte teller sammen. P-grensen er 3,5 kg P/daa i 2026 (2,8 fra 2027, 2,3 fra 2033) og kan
justeres i innstillingene.

## Kom i gang

```bash
cd gjodselapp
npm install
npm run dev        # http://localhost:3000
```

Appen fungerer umiddelbart uten Azure-oppsett – registreringer lagres da bare lokalt.
De tolv leveringene fra spredesesongen 2026 er forhåndslastet ved første oppstart.

## Azure-oppsett (OneDrive-synkronisering)

1. Gå til [portal.azure.com](https://portal.azure.com) → *Microsoft Entra ID* → *App registrations* → **New registration**.
2. Navn: f.eks. `Gjodseljournal`. Kontotyper: *Personal Microsoft accounts* (eller org + personal).
3. Under **Authentication** → *Add a platform* → **Single-page application**, og legg inn appens
   URL som redirect-URI (vises også nederst i Innstillinger-fanen, f.eks. `http://localhost:3000`
   og produksjons-URL-en).
4. Under **API permissions**: `Files.ReadWrite` (delegated) – `offline_access` håndteres av MSAL.
5. Kopier **Application (client) ID** inn i appens Innstillinger (eller `.env.local`).

### Finne fil-ID-en til Excel-arbeidsboken

Åpne [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), logg inn og kjør:

```
GET https://graph.microsoft.com/v1.0/me/drive/root/children
```

Finn arbeidsboken i svaret og kopier `id`-feltet inn i Innstillinger → *OneDrive fil-ID*.

### Excel-format (arket «Spredejournal»)

Appen bruker første Excel-tabell i arket hvis det finnes en; ellers appendes raden rett under
brukt område. Kolonner A–H:

| Kol | Innhold |
|-----|---------------------|
| A | Dato (dd.mm.yyyy) |
| B | Skifte |
| C | Mottaker |
| D | Antall lass |
| E | Total mengde (t) |
| F | Mengde (kg/daa) |
| G | Tilført P (kg/daa) |
| H | Status |

> Inneholder Excel-filen allerede de forhåndslastede radene, bruk «Merk alt som synkronisert»
> i Innstillinger for å unngå duplikater ved første synkronisering.

## Installere som app på iPhone

1. Åpne appens URL i Safari.
2. Del-knappen → **Legg til på Hjem-skjerm**.
3. Appen kjører da i fullskjerm (standalone) med eget ikon.

## Prosjektstruktur

```
gjodselapp/
├── public/
│   ├── manifest.json        # PWA-manifest
│   ├── sw.js                # Service worker (offline app-shell)
│   └── icon-192/512.png     # App-ikoner
└── src/
    ├── app/                 # Next.js App Router
    │   ├── layout.tsx       # Metadata, viewport, providers, skall
    │   ├── page.tsx         # Registrer (primær feltvisning)
    │   ├── logg/            # Logg
    │   ├── skifter/         # Per skifte
    │   └── innstillinger/   # Innstillinger
    ├── components/
    │   ├── Providers.tsx    # Auth- (MSAL) og sync-kontekst
    │   ├── AppShell.tsx     # Header, bunn-navigasjon, safe areas
    │   ├── RegistrerForm.tsx
    │   ├── LoggList.tsx
    │   ├── SkifteOversikt.tsx
    │   ├── SettingsView.tsx
    │   ├── Toast.tsx
    │   ├── SwRegister.tsx
    │   └── ui.tsx           # StatusChip, SyncChip, PBar, Field
    ├── lib/
    │   ├── calc.ts          # Beregningslogikk og statusvurdering
    │   ├── graph.ts         # Microsoft Graph (tabell + usedRange-fallback)
    │   ├── msal.ts          # MSAL-instans fra innstillingene
    │   ├── seed.ts          # Forhåndslastede 2026-leveringer
    │   ├── format.ts
    │   └── types.ts
    └── store/
        ├── entries.ts       # Registreringer (Zustand + localStorage)
        └── settings.ts      # Innstillinger (Zustand + localStorage)
```

## Forskriftskrav (§ 27)

Journalen dekker dato for spredning, skiftenavn, mengde gjødsel (tonn) og tilført fosfor
(kg P/daa), og kan fremvises fra Excel-arbeidsboken. Ved bortlevering over 75 kg P: bruk
mottaker-feltet, så inneholder raden mengde, kg fosfor, dato og mottaker.
