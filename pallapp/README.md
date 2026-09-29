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

**Uavhengig av Elkjøp:** Løsningen bruker ikke Elkjøps Microsoft 365, OneDrive eller IT-tilganger, og
krever ingen administrator hos Elkjøp. Gården eier Cloudflare-kontoen selv. Brukerne logger inn med en
engangskode på e-post. Bruk gårdens eller private e-postadresser, så er dere helt uavhengige av
Elkjøps e-post.

**Excel:** Oversikten kan eksporteres til Excel (CSV) med ett trykk og lagres hvor dere vil, også i
OneDrive. Appen skriver ikke direkte til OneDrive, fordi det ville krevd Microsoft-tilganger dere ikke har.

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

## Oppsett (én gang, ca. 30 min, bare i nettleseren)

Du trenger bare nettleseren, en gratis Cloudflare-konto og tilgang til dette GitHub-repoet.
GitHub publiserer appen og oppretter databasetabellene automatisk.

**Del A – Cloudflare: hent tre verdier**
1. **Konto-ID:** Logg inn på dash.cloudflare.com. Adressen i nettleseren ser slik ut:
   `dash.cloudflare.com/`**`<32 tegn>`**`/…`. De 32 tegnene er konto-ID-en. Den står også på
   *Workers & Pages* til høyre under *Account ID*.
2. **workers.dev-adresse:** Menyen til venstre → *Compute (Workers)* → *Workers & Pages*. Blir du bedt om
   å velge et *subdomain*, skriv f.eks. `klokkargarden`. Appen får da adressen
   `https://pallsporing.klokkargarden.workers.dev`.
3. **Database:** Menyen → *Storage & Databases* → *D1 SQL Database* → **Create Database** → navn
   `pallsporing` → **Create**. Kopier **Database ID** fra siden som vises.
4. **API-token:** Øverst til høyre → profilikonet → *Profile* → *API Tokens* → **Create Token** →
   mal **Edit Cloudflare Workers** → *Use template*.
   * Under *Permissions*: **+ Add more** → *Account* · *D1* · *Edit*.
   * *Account Resources*: *Include* · din konto. *Zone Resources*: *Include* · *All zones*.
   * **Continue to summary** → **Create Token** → kopier tokenet. Det vises bare én gang.

Finner du ikke et menyvalg, bruk søkefeltet (Ctrl+K) og søk etter «D1», «API Tokens» osv.

**Del B – GitHub: lagre verdiene og publiser**
1. github.com/ingarteigene-svg/honseri → *Settings* → *Secrets and variables* → *Actions* →
   **New repository secret**, én om gangen:
   `CLOUDFLARE_API_TOKEN` (tokenet), `CLOUDFLARE_ACCOUNT_ID` (konto-ID-en), `D1_DATABASE_ID` (database-ID-en).
2. Merge pull requesten for Pallsporing, eller gå til *Actions* → *Pallsporing – test og publisering* →
   **Run workflow**.
3. Når kjøringen er grønn, er appen publisert. Åpner du adressen nå, får du en feilmelding om at
   innlogging ikke er konfigurert. Det er riktig: appen stenger alle ute til del C er gjort.

**Del C – Innlogging (Cloudflare Access)**
1. *Workers & Pages* → **pallsporing** → *Settings* → *Domains & Routes* → ved *workers.dev*:
   **Enable Cloudflare Access**. Første gang opprettes Zero Trust. Velg et teamnavn, f.eks. `klokkargarden`,
   og planen **Free**. Cloudflare kan be om betalingskort; det belastes ikke på Free.
2. **Manage Cloudflare Access** → rediger policyen: *Include* → *Emails* → legg inn e-postadressen til hver
   godkjente bruker. Fjern andre regler, for eksempel «hele e-postdomenet». Sett gjerne *Session duration*
   til 30 dager, så slipper pakkeriet å logge inn ofte.
3. Noter **Application Audience (AUD) Tag** (Zero Trust → *Access* → *Applications* → pallsporing) og
   **teamdomenet** (Zero Trust → *Settings*, f.eks. `klokkargarden.cloudflareaccess.com`).
4. Legg dem inn som GitHub-secrets `ACCESS_AUD` og `ACCESS_TEAM_DOMAIN` (som i B1), og kjør workflowen igjen (B2).
5. **Test:** Åpne adressen i et privat nettleservindu. Du skal få en innloggingsside med engangskode på e-post.
   En e-postadresse som ikke står i policyen, skal avvises.
6. **På mobil:** Åpne adressen i Safari/Chrome → Del → **Legg til på Hjem-skjerm**.

**Brukere:** Legg til og fjern brukere i Access-policyen (C2). For å kaste ut en bruker umiddelbart:
Zero Trust → *My Team → Users* → velg bruker → **Revoke session**.

**Alternativ fra PC** (krever [Node.js 22](https://nodejs.org)): `npx wrangler login`, og lag deretter
`pallapp/.env.prod` fra `.env.prod.example` og kjør `npm run deploy`. Samme PC-oppsett brukes til den
ukentlige sikkerhetskopien (`npm run backup`, se under).

## Bruk

**Ny pall:** Skriv pallnummeret fra kortet og kontroller verpedato (standard: i dag, eller
sist brukte dato samme dag). Trykk «Flere verpedager?» hvis pallen dekker flere dager. Trykk
**200** eller **228** brett (appen husker siste valg), eller «Annet antall» for en ufullstendig pall, og
trykk **Lagre pall**. Grønn boks betyr lagret i databasen. Pakkedato og bruker lagres automatisk.

**Levering:** Kryss av pallene, velg butikk (eller «+ Ny butikk»), skriv ordre-/fakturanummer, og
kontroller leveringsdato. Trykk **Registrer levering**, kontroller pallnumre og antall brett i
bekreftelsen, og trykk **Bekreft levering**. Bare paller på lager vises. Butikker kan rettes under «Butikker» nederst.

**Oversikt:** Søk på pallnummer, ordre-/fakturanummer, butikk og/eller verpedato. Datosøk finner
alle paller der verpeperioden **overlapper** søkeperioden, og én dato alene betyr den ene dagen.
Trykk på et pallnummer for detaljer, rettelser og full historikk. **Eksporter til Excel** laster ned
alle paller, eller bare søketreffet, som en CSV-fil (semikolon og UTF-8) som åpnes direkte i Excel.

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

**Lag 2 – månedlig Excel-kopi (enkel, uten verktøy):** Oversikt → **Eksporter alle paller til Excel** →
lagre filen i OneDrive, f.eks. `Pallsporing-ÅÅÅÅ-MM.csv`. Dette er en lesbar kopi av status for alle paller,
men ikke en full sikkerhetskopi, fordi historikken ikke er med.

**Lag 3 – full sikkerhetskopi (ukentlig, fra kontor-PC):**
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
npm test                         # 24 automatiske tester
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
