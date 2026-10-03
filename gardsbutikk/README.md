# Gårdsbutikk – selvbetjent salg med Vipps og kontant

Kunden skanner en QR-kode på døra, velger varer på sin egen telefon og betaler med **Vipps**.
Betaler kunden kontant, trykker hen **Kontant**, og handelen registreres. Pengene legges i kassa.
Lageret trekkes automatisk, og du får salg per vare, kassaoppgjør og Excel-eksport i en egen adminside.

Ingen app å installere for kunden, ingen terminal og ingen maskinvare utover en utskrevet QR-plakat.

| Vare | Pris |
|---|---|
| 🥚 Vanlig eggbrett | 100 kr |
| 🥚 XL eggbrett | 120 kr |
| 🍳 Klink | 40 kr |
| 📦 Kartong 10 pk | 40 kr |

Priser, navn og varer endres i adminsiden (**Varer**), uten å røre koden.

## Løsning og kostnader

| Del | Tjeneste | Pris |
|---|---|---|
| Butikk (kundene) | Cloudflare Worker «gardsbutikk», åpen | Gratis: 100 000 forespørsler/døgn |
| Adminside | Cloudflare Worker «gardsbutikk-admin», bak Cloudflare Access | Gratis opptil 50 brukere |
| Database | Cloudflare D1 «gardsbutikk» (Vest-Europa) | Gratis: 5 GB |
| Betaling | Vipps ePayment API på din eksisterende Vipps-avtale | Vipps' vanlige gebyr per transaksjon |
| Kode og test | GitHub + GitHub Actions | Gratis |

**Løpende kostnad utover Vipps-gebyret: 0 kr.**

Samme kode publiseres som to Workers mot samme database. Butikken svarer ikke på adminadressene
i det hele tatt, og adminsiden ligger bak innlogging. Da kan butikken være helt åpen uten at
noe av adminsiden er eksponert.

## Slik fungerer det for kunden

1. Skanner QR-koden og ser varene med pris og om de er på lager («På lager», «Få igjen», «Kan være tomt»).
2. Trykker **+** på det hen tar med seg. Summen vises nederst.
3. **Betal med Vipps** åpner Vipps-appen med riktig beløp. Etter godkjenning kommer kunden
   tilbake til en kvittering med ordrenummer, varer, sum og MVA.
4. **Kontant**: appen viser beløpet som skal i kassa. Kunden bekrefter, og får kvittering.

Siden finnes på norsk og engelsk (knapp øverst til høyre).

**Kunden lukker Vipps uten å gå tilbake?** Workeren sjekker ventende Vipps-betalinger hvert
2. minutt og fullfører dem. Ingen betaling går tapt, og lageret blir riktig.

## Adminsiden

| Fane | Innhold |
|---|---|
| 📊 Oversikt | Omsetning, Vipps/kontant og MVA for valgt periode. Lager per vare med **Påfyll**, **Telling** og historikk |
| 🧾 Salg | Alle handler med status. Annuller (Vipps-beløp betales automatisk tilbake). Excel-eksport |
| 💵 Kasse | Forventet beløp i kassa siden sist. Registrer telling, og se differansen |
| 📦 Varer | Navn, pris, beskrivelse, ikon, MVA og rekkefølge. Ny vare, eller skjul en vare |
| ⚙️ Oppsett | Butikkinfo på kvitteringen, melding øverst i butikken, Vipps-status og **QR-plakat** |

**Daglig rutine (forslag)**
* Når du fyller på: **Oversikt → Påfyll** på varen.
* Ukentlig: **Telling** av hver vare. Differansen føres som svinn, og vises i oversikten.
* Når du tømmer kassa: **Kasse → Registrer telling**. Du ser om det mangler penger.

## Oppsett (én gang, ca. 30 min, bare i nettleseren)

Cloudflare-kontoen, API-tokenet og Access-teamet fra Pallsporing og Hønseri gjenbrukes.

### Del A – Publisering (skjer automatisk)
Når denne mappen ligger i `main`, publiserer GitHub begge Workers og oppretter databasen selv.
Se kjøringen under *Actions* → *Gårdsbutikk – test og publisering*. Adressene blir:
* Butikk: `https://gardsbutikk.<ditt-subdomene>.workers.dev`
* Admin: `https://gardsbutikk-admin.<ditt-subdomene>.workers.dev`

Uten Vipps-nøkler tar butikken bare kontant. Adminsiden avviser alt til del B er gjort.

### Del B – Innlogging til adminsiden (Cloudflare Access)
**Viktig:** Slå på Access bare for **gardsbutikk-admin**, ikke for gardsbutikk. Kundene skal ikke logge inn.
1. dash.cloudflare.com → *Workers & Pages* → **gardsbutikk-admin** → *Settings* → *Domains & Routes* →
   ved *workers.dev*: **Enable Cloudflare Access**.
2. **Manage Cloudflare Access** → rediger policyen: *Include* → *Emails* → legg inn e-postadressene som
   skal se salgstallene. Sett *Session duration* til 30 dager.
3. Kopier **Application Audience (AUD) Tag**: Zero Trust → *Access* → *Applications* → gardsbutikk-admin.
4. GitHub → *Settings* → *Secrets and variables* → *Actions* → **New repository secret**:
   `GARDSBUTIKK_ACCESS_AUD` = AUD-taggen. `ACCESS_TEAM_DOMAIN` finnes allerede.
5. *Actions* → *Gårdsbutikk – test og publisering* → **Run workflow**.

### Del C – Vipps (først testmiljø, så ekte)
Du trenger et salgssted med **API-tilgang** (ePayment / «Vipps på nett») på Vipps-avtalen din.
Har dagens salgssted bare et Vippsnummer, bestiller du et slikt salgssted på portal.vipps.no.

1. portal.vipps.no → *For utviklere* → fanen **Test** → velg salgsstedet → **Vis nøkler**.
2. Legg inn fire GitHub-hemmeligheter (samme sted som i del B):

   | Hemmelighet | Fra portalen |
   |---|---|
   | `GARDSBUTIKK_VIPPS_CLIENT_ID` | client_id |
   | `GARDSBUTIKK_VIPPS_CLIENT_SECRET` | client_secret |
   | `GARDSBUTIKK_VIPPS_SUBSCRIPTION_KEY` | Ocp-Apim-Subscription-Key (primærnøkkel) |
   | `GARDSBUTIKK_VIPPS_MSN` | Merchant Serial Number (salgsstedsnummer) |

3. **Run workflow.** Butikken viser nå en rød linje: «Testmodus …».
4. **Test hele flyten** med Vipps' testapp (Vipps MT) og en testbruker fra portalen: kjøp, avbryt,
   lukk Vipps midt i, og annuller et kjøp i adminsiden. Sjekk at lageret og kassa stemmer.
5. **Gå live:** Bytt til nøklene fra fanen **Produksjon** i de fire hemmelighetene, legg til
   `GARDSBUTIKK_VIPPS_ENV` = `prod`, og kjør **Run workflow**. Den røde testlinja forsvinner.
6. Adminsiden → **Oppsett** → **Test tilkoblingen** skal vise «Vipps svarer (produksjon)».

Nøklene legges inn som krypterte hemmeligheter i Cloudflare, og vises aldri i koden eller i loggene.

### Del D – Butikkinfo og QR-plakat
1. Adminsiden → **Oppsett**: fyll inn org.nr. (f.eks. «NO 999 888 777 MVA»), adresse og kontakt.
   Dette står på kvitteringen.
2. Åpne butikkadressen én gang (eller trykk **Åpne butikken**), så kjenner appen adressen sin.
3. **Skriv ut QR-plakat**, og heng den på døra og ved kassa. Lamineres plakaten, tåler den fuktig fjøsluft.
4. **Oversikt → Telling** på hver vare, så lagerstatusen blir riktig fra første dag.

## Hvordan pengene og dataene er sikret

* **Beløpet bestemmes av serveren**, ut fra prisene i databasen. Kunden kan ikke endre prisen.
  Før en betaling godkjennes, sjekkes det at beløpet hos Vipps stemmer med ordren.
* **Ingen kortdata og ingen kundedata.** Betalingen skjer i Vipps. Butikken lagrer bare varer,
  sum og en hashet IP-adresse (brukes mot misbruk: maks 20 handler per 10 minutter per IP).
* **Lageret trekkes nøyaktig én gang per salg**, også om bekreftelsen kommer flere ganger.
* **Ingenting slettes.** Feil handler annulleres (varene går tilbake på lager, Vipps-beløpet
  betales tilbake). Beløp på en ordre kan ikke endres i ettertid, og lagerbevegelser og
  kassatellinger kan ikke redigeres. Databasen håndhever dette, ikke bare appen.
* **Revisjonslogg** (`audit_log`) for endringer av varer, priser, innstillinger og annulleringer.
* **Adminsiden:** Cloudflare Access foran, og Workeren sjekker i tillegg Access-tokenet
  kryptografisk. Uten oppsett avvises alt.

## Regnskap og regelverk – avklar med regnskapsfører

> Appen gir kvittering med MVA og en full salgsliste til Excel, men den er **ikke** et
> sertifisert kassasystem etter kassasystemloven.

* **Kassasystemkravet:** Kontant-, kort- og Vipps-salg kan utløse krav om et kassasystem meldt
  til Skatteetaten. Det finnes unntak, men om de dekker et selvbetjent utsalg som dette, må
  regnskapsføreren avgjøre **før** butikken settes i drift.
* **Kontanter:** Om plikten til å ta imot kontanter gjelder ubetjente utsalg, bør også sjekkes.
  Appen tar imot kontant uansett.
* **Bokføring:** Bruk **Salg → Excel** per måned som bilag. Vipps-oppgjøret i portal.vipps.no
  avstemmes mot Vipps-summen i oversikten, og kassatellingene mot kontantsummen.

## Sikkerhetskopi

**Lag 1 – automatisk:** D1 kan settes tilbake til et hvilket som helst minutt de siste 7 dagene (*Time Travel*).

**Lag 2 – månedlig Excel:** **Salg** → velg *Forrige måned* → **Excel**, og lagre fila i OneDrive.

**Lag 3 – full kopi fra PC** (krever [Node.js 22](https://nodejs.org)):
```bash
cd honseri/gardsbutikk
npm install
npx wrangler login          # eller lag .env.prod fra .env.prod.example
npm run backup              # → backup/gardsbutikk-ÅÅÅÅ-MM-DD-TT-MM.sql
```

## Utvikling og tester

```bash
cd gardsbutikk
npm install
cp .dev.vars.example .dev.vars   # lokal testbruker, virker bare på localhost
npm run dev                      # http://localhost:8787 (butikk) og /admin/
npm test                         # 27 automatiske tester
```

Testene kjører mot en ekte lokal Worker med egen database og en falsk Vipps-tjeneste. De dekker
hele betalingsflyten (godkjent, avbrutt, kunden kommer ikke tilbake, beløpsavvik, Vipps nede),
kontantsalg, MVA, lager med påfyll, telling og svinn, kassaoppgjør, annullering med
tilbakebetaling, prisendringer, sletteforbud, vern mot skriving fra andre nettsteder, Access-tokenet
og at butikk-Workeren ikke svarer på adminadressene.

```
gardsbutikk/
├── migrations/0001_init.sql   # tabeller, regler og startvarer
├── src/index.js               # API, butikk og admin, cron for Vipps
├── src/vipps.js               # Vipps ePayment API uten eksterne bibliotek
├── src/auth.js                # kontroll av Cloudflare Access-token
├── public/index.html          # butikken (kunden)
├── public/admin/              # adminsiden
├── scripts/prod.mjs           # npm run deploy / npm run backup
├── test/                      # automatiske tester
└── wrangler.toml              # konfigurasjon uten hemmeligheter
```

Endringer i databasestrukturen gjøres med en ny fil, `migrations/0002_….sql`. Publiseringen kjører den automatisk.
