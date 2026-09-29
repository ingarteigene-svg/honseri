# Pallsporing – Klokkargarden

Enkel webapp for sporbarhet av eggpaller: **Ny pall → Levering → Oversikt/tilbakekalling.**
Appen brukes fra mobil i pakkeriet og fra PC på kontoret, mot én felles database.

> Appen er et hjelpemiddel for egen sporbarhet og internkontroll. Den gir **ikke** i seg selv
> godkjenning fra Mattilsynet, og den erstatter ikke gårdens øvrige rutiner og dokumentasjon.

## Løsning og kostnader

| Del | Tjeneste | Pris |
|---|---|---|
| App og API | Cloudflare Workers (statiske filer + `src/index.js`) | Gratis: 100 000 forespørsler/døgn |
| Database | Cloudflare D1 (SQLite) | Gratis: 5 GB, 5 mill. leste / 100 000 skrevne rader per døgn |
| Innlogging | Cloudflare Access (Zero Trust Free) | Gratis opptil 50 brukere |
| Kode og test | GitHub + GitHub Actions | Gratis |

**Løpende kostnad: 0 kr** ved normal bruk. Det er ingen betalte tjenester å aktivere.
Cloudflare kan be om betalingskort når Zero Trust aktiveres, også på gratisplanen. Kortet belastes ikke så lenge planen er Free.

Valgfritt: **Workers Paid (ca. 5 USD/mnd)** øker automatisk gjenopprettingsvindu fra 7 til 30 dager.
Aktiver bare hvis dere ønsker det; appen fungerer likt uten.

Hvorfor ikke Google Regneark eller GitHub Pages, som de andre gårdsappene bruker? Kravene om
unike pallnumre ved samtidig lagring, garantert «ikke levert to ganger», innlogging per
person og en logg som ikke kan redigeres bort, trenger en ekte database med regler. Et regneark
kan redigeres direkte forbi alle kontroller, og GitHub Pages kan ikke kjøre server-kode.

## Hvordan dataene er sikret

* **Én felles database** (D1). Nettleseren lagrer bare sist brukte verpedato og antall brett, som et forslag.
* **Innlogging:** Cloudflare Access slipper bare inn e-postadresser du har godkjent. Brukeren
  får en engangskode på e-post, og det finnes ingen selvregistrering og ingen passord å huske.
  Workeren sjekker i tillegg Access-tokenet kryptografisk, og uten oppsett avviser den alt.
* **Regler i databasen** (`migrations/0001_init.sql`). De gjelder også når to brukere lagrer samtidig:
  * Pallnummer er unikt (`UNIQUE`) og kan aldri endres eller brukes på nytt.
  * En pall kan bare leveres hvis den er på lager, ikke sperret og ikke annullert (trigger).
    En levering med flere paller lagres alt-eller-ingenting.
  * Antall brett > 0 (heltall), og verpedato fra ≤ til.
  * **Ingenting kan slettes.** Feilregistreringer annulleres eller rettes.
* **Revisjonslogg:** Hver ny registrering og endring skrives automatisk til `audit_log` med
  hvem, når, gamle og nye verdier og årsak. Rettelser krever årsak, og loggen kan ikke endres.
* **Leveringsstatus og tilbakekalling er adskilt.** Sperring og «berørt» endrer aldri leveransen.
* «Lagret» vises først når databasen har bekreftet lagringen. Ved feil vises en rød melding
  som sier at ingenting ble lagret.

Pallnummer normaliseres før lagring: mellomrom fjernes, bokstaver blir store, og ledende nuller
i rene tall fjernes («007» = «7»). Dermed kan samme kort ikke registreres to ganger med ulik skrivemåte.

## Oppsett (én gang, ca. 30 min)

Du trenger en PC med [Node.js 22](https://nodejs.org) og en gratis Cloudflare-konto.

1. **Last ned koden og installer**
   ```bash
   git clone https://github.com/ingarteigene-svg/honseri.git
   cd honseri/pallapp
   npm install
   npx wrangler login          # åpner nettleseren – logg inn i Cloudflare
   ```
2. **Opprett databasen**
   ```bash
   npx wrangler d1 create pallsporing
   ```
   Noter `database_id` fra svaret. Den skal **ikke** inn i Git.
3. **Lag `pallapp/.env.prod`** (kopi av `.env.prod.example`, ligger i `.gitignore`) og fyll inn
   `CLOUDFLARE_ACCOUNT_ID` (Cloudflare-dashbord → konto → *Account ID*) og `D1_DATABASE_ID`.
4. **Første publisering:** `npm run deploy`. Tabellene opprettes, og appen publiseres til
   `https://pallsporing.<ditt-subdomene>.workers.dev`. Inntil punkt 5 er gjort, avviser appen alle forespørsler.
5. **Slå på innlogging (Cloudflare Access)**
   1. Dashbord → *Workers & Pages* → **pallsporing** → *Settings* → *Domains & Routes* →
      ved *workers.dev*: **Enable Cloudflare Access**. Følg veiviseren for Zero Trust (velg Free) første gang.
   2. **Manage Cloudflare Access** → rediger policyen: *Include → Emails* → legg inn e-postadressen til hver
      godkjente bruker. Fjern andre regler, for eksempel «hele e-postdomenet».
   3. Sett gjerne *Session duration* til 30 dager, så slipper pakkeriet å logge inn ofte.
   4. Noter **Application Audience (AUD) Tag** (Zero Trust → Access → Applications → pallsporing) og
      teamdomenet (Zero Trust → Settings → *Team domain*, f.eks. `klokkargarden.cloudflareaccess.com`).
   5. Legg dem inn i `.env.prod` som `ACCESS_AUD` og `ACCESS_TEAM_DOMAIN`, og kjør `npm run deploy` igjen.
6. **Automatisk publisering fra GitHub (anbefalt):** Opprett et API-token (Cloudflare → *My Profile* →
   *API Tokens* → mal **Edit Cloudflare Workers**, og legg til *Account → D1 → Edit*). Legg deretter inn disse
   under GitHub → repo → *Settings → Secrets and variables → Actions → New repository secret*:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
   Deretter testes og publiseres appen automatisk ved hver endring i `pallapp/` på `main`
   (`.github/workflows/pallsporing.yml`). Uten disse hemmelighetene kjører bare testene.
7. **Test innlogging:** Åpne adressen i et privat nettleservindu. Du skal få Access-innlogging, og
   en e-postadresse som ikke står i policyen, skal avvises.
8. **På mobil:** Åpne adressen i Safari/Chrome → Del → **Legg til på Hjem-skjerm**.

**Brukere:** Legg til og fjern brukere i Access-policyen (punkt 5.2). For å kaste ut en bruker
umiddelbart: Zero Trust → *My Team → Users* → velg bruker → **Revoke session**.

## Bruk

**Ny pall:** Skriv pallnummeret fra kortet og kontroller verpedato (standard: i dag, eller
sist brukte dato samme dag). Trykk «Flere verpedager?» hvis pallen dekker flere dager. Juster antall
brett med − / +, og trykk **Lagre pall**. Grønn boks = lagret i databasen. Pakkedato og bruker lagres automatisk.

**Levering:** Kryss av pallene, velg butikk (eller «+ Ny butikk»), skriv ordre-/fakturanummer, og
kontroller leveringsdato. Trykk **Registrer levering**, kontroller pallnumre og antall brett i
bekreftelsen, og trykk **Bekreft levering**. Bare paller på lager vises. Butikker kan rettes under «Butikker» nederst.

**Oversikt:** Søk på pallnummer, ordre-/fakturanummer, butikk og/eller verpedato. Datosøk finner
alle paller der verpeperioden **overlapper** søkeperioden, og én dato alene betyr den ene dagen.
Trykk på et pallnummer for detaljer, rettelser og full historikk.

**Rettelser (alltid med årsak, alt logges):**

| Feil | Gjør dette på pallsiden |
|---|---|
| Feil verpedato eller antall brett | «Rett verpedato / brett» |
| Feil butikk, ordrenr. eller leveringsdato | «Rett levering» (gjelder hele leveringen) |
| Pall ført på feil levering | «Fjern fra levering», og lever deretter riktig |
| Feil pallnummer | «Annuller (feilregistrering)», og registrer riktig nummer på nytt. Det gamle nummeret forblir reservert. |
| Sperret ved en feil | «Opphev sperre» |

**Tilbakekalling:**
1. I Oversikt: søk (typisk på verpedato), og kryss av berørte paller eller «Velg alle i treffet».
2. **Merk som berørt …**: gi en kort beskrivelse, eller legg til i en eksisterende tilbakekalling.
3. På tilbakekallingssiden:
   * **Sperr N paller på lager.** Sperrede paller kan ikke leveres.
   * Se **butikker som har mottatt** berørte paller, med paller, brett/egg, leveringsdato og ordrereferanse.
   * Kontakt butikken selv (telefon/e-post vises), og registrer **«Butikk varslet»** med dato og notat.
   * **Eksporter CSV** (semikolon og UTF-8, åpnes direkte i Excel).

Appen sender aldri meldinger selv.

## Sikkerhetskopi og gjenoppretting

**Lag 1 – automatisk (Cloudflare D1 Time Travel):** Databasen kan settes tilbake til et hvilket som helst
minutt de siste **7 dagene** (30 dager med Workers Paid). Dette krever ikke noe oppsett.

**Lag 2 – ukentlig eksport til egen lagring (rutine på kontoret):**
```bash
cd honseri/pallapp
npm run backup        # → backup/pallsporing-ÅÅÅÅ-MM-DD-TT-MM.sql
```
Flytt filen til OneDrive eller en annen sikker lagring. **Ikke legg sikkerhetskopier i GitHub**, fordi
`backup/` er i `.gitignore`. Anbefalt rutine: hver mandag, og alltid før større endringer. Ta vare på minst 12 uker.

**Gjenopprette:**

*A) Feil de siste 7 dagene (for eksempel en uønsket massendring):*
```bash
npx wrangler d1 time-travel info pallsporing --timestamp=2026-10-05T08:00:00+02:00
npx wrangler d1 time-travel restore pallsporing --timestamp=2026-10-05T08:00:00+02:00
```
Restore overskriver databasen. Kommandoen skriver ut en *bookmark* som kan brukes til å angre selve gjenopprettingen.

*B) Fra en eksportfil (for eksempel hvis databasen er tapt):*
```bash
npx wrangler d1 create pallsporing-gjenopprettet                        # noter ny database_id
npx wrangler d1 execute pallsporing-gjenopprettet --remote --file=backup/pallsporing-….sql
```
Sett den nye ID-en i `.env.prod` (og GitHub-hemmeligheten `D1_DATABASE_ID`), og kjør `npm run deploy`.
Eksportfilen inneholder tabeller, data, revisjonslogg og regler. Dette er testet: en gjenopprettet
kopi hadde identisk antall paller, leveringer, loggrader og triggere.

**Test gjenoppretting to ganger i året:** Kjør B mot en midlertidig database, og sjekk antall paller med
`npx wrangler d1 execute pallsporing-gjenopprettet --remote --command "SELECT count(*) FROM pallets"`.
Slett deretter testdatabasen i dashbordet.

## Utvikling og tester

```bash
cd pallapp
npm install
cp .dev.vars.example .dev.vars   # lokal testbruker, virker bare på localhost
npm run dev                      # http://localhost:8787 med lokal database
npm test                         # 23 automatiske tester
```

Testene (`test/`) kjører mot en ekte lokal Worker med egen database og dekker blant annet:
dobbel levering (også 10 samtidige forsøk), duplikat-pallnummer (20 samtidige forsøk),
overlappende datosøk (kanttilfeller), rettelser med historikk, sletteforbud, tilbakekalling/CSV
og verifisering av innloggingstoken.

```
pallapp/
├── migrations/0001_init.sql   # tabeller, regler (triggere) og revisjonslogg
├── src/index.js               # API
├── src/auth.js                # verifisering av Cloudflare Access-token
├── public/                    # grensesnitt (HTML/CSS/JS, uten byggesteg)
├── scripts/prod.mjs           # npm run deploy / npm run backup
├── test/                      # automatiske tester
└── wrangler.toml              # konfigurasjon uten hemmeligheter
```

Endringer i databasestrukturen gjøres med en ny fil, `migrations/0002_….sql`. `npm run deploy` kjører den automatisk.
