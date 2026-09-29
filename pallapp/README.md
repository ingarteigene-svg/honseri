# Pallsporing – Klokkargarden

Enkel webapp for sporbarhet av eggpaller: **Ny pall → Levering → Oversikt/tilbakekalling.**
Appen brukes fra mobil i pakkeriet og fra PC på kontoret. Alle data lagres i **én Excel-fil i
OneDrive for Business / SharePoint**, og appen publiseres med **GitHub Pages**. Ingen andre tjenester er involvert.

> Appen er et hjelpemiddel for egen sporbarhet og internkontroll. Den gir **ikke** i seg selv
> godkjenning fra Mattilsynet, og den erstatter ikke gårdens øvrige rutiner og dokumentasjon.

Adresse etter oppsett: `https://ingarteigene-svg.github.io/honseri/pall/`

## Løsning og kostnader

| Del | Tjeneste | Kostnad |
|---|---|---|
| App | GitHub Pages (samme publisering som de andre gårdsappene) | 0 kr |
| Innlogging | Microsoft 365 / Entra ID (gårdens eksisterende konto) | 0 kr ekstra |
| Data | Excel-fil i OneDrive for Business eller SharePoint | 0 kr ekstra |

**Løpende kostnad: 0 kr** utover Microsoft 365-lisensene dere allerede har. Alle brukere må ha en
Microsoft 365-konto i gårdens organisasjon.

## Hvordan dataene er sikret

**Excel-arket «Hendelser» er en logg der appen bare legger til rader.** Hver registrering,
levering, rettelse, sperring og varsling blir en ny rad med tidspunkt, bruker, verdier, årsak og
(ved rettelser) *tidligere verdier*. Appen endrer eller sletter aldri en rad. Gjeldende status for
hver pall regnes ut ved å lese loggen ovenfra og ned.

* **Ingen dobbel levering og ingen duplikat-pallnummer, også ved samtidig lagring.** Excel legger nye
  rader etter hverandre i én rekkefølge, og **første rad vinner**. Etter hver lagring leser appen arket
  på nytt og kontrollerer at egen rad ble godtatt. Kom noen andre først, får brukeren en feilmelding som
  sier hvem, og raden merkes `AVVIST` i loggen. En levering med flere paller godtas helt eller ikke i det hele tatt.
* **«Lagret» vises først når Excel har bekreftet lagringen og kontrollen er bestått.** Ved nettverksfeil
  sjekker appen om raden kom inn før den prøver igjen, så det blir ingen dobbeltføring.
* **Tekst lagres som tekst.** Ordrenummer som «00455» beholder de ledende nullene, og innhold som starter
  med «=» blir ikke til formler.
* **Kontrollsum per rad.** Appen oppdager rader som er endret eller lagt inn direkte i Excel, og viser en
  advarsel i Oversikt. Den varsler også hvis arket er blitt sortert, fordi rekkefølgen avgjør hvem som kom først.
* **Innlogging:** Bare brukere i gårdens Microsoft 365, som er tildelt appen i Entra ID, **og** som har fått
  Excel-filen delt med seg, kommer inn. Det finnes ingen selvregistrering.

**Begrensning du må kjenne til:** Alle som kan lagre via appen, har også redigeringstilgang til
Excel-filen. Appen kan derfor ikke *hindre* at noen endrer eller sletter rader direkte i Excel. Den
kan bare *oppdage* det (kontrollsum og rekkefølge), og OneDrives versjonslogg viser hvem som endret hva.
**Regel for alle brukere: Arket «Hendelser» skal ikke redigeres eller sorteres i Excel. Bruk filter,
eller *Arkvisning* (Sheet View) i Excel for nettet, for å se utvalg.**

## Oppsett (én gang, ca. 30 minutter, krever Microsoft 365-administrator)

### 1. Excel-filen
1. Opprett en tom arbeidsbok, f.eks. `Pallsporing.xlsx`. Legg den helst i et **SharePoint-/Teams-område
   som eies av gården**, ikke i én persons OneDrive, slik at filen ikke forsvinner hvis personen slutter.
2. **Del** → *Bestemte personer* → legg inn alle godkjente brukere → **Kan redigere** → **Kopier kobling**.
   Denne lenken er `PALL_FILE_URL`.
3. Appen oppretter selv arket og tabellen «Hendelser» første gang noen logger inn.

### 2. App-registrering i Entra ID (entra.microsoft.com)
1. *Applications → App registrations → New registration*
   * Navn: `Pallsporing`
   * Kontotyper: **Accounts in this organizational directory only** (én tenant)
   * Redirect URI: **Single-page application (SPA)** → `https://ingarteigene-svg.github.io/honseri/pall/`
2. *API permissions → Add → Microsoft Graph → Delegated* → **Files.ReadWrite.All** → **Grant admin consent**.
3. Noter **Application (client) ID** og **Directory (tenant) ID** fra *Overview*.
4. **Begrens hvem som kan logge inn:** *Enterprise applications → Pallsporing → Properties →
   Assignment required = Yes → Users and groups → Add* de godkjente brukerne.

> `Files.ReadWrite.All` lar appen, mens brukeren er innlogget, nå filer brukeren selv har tilgang til.
> Koden bruker den bare mot den ene Excel-filen i `PALL_FILE_URL`, og all koden er åpen i dette repoet.

### 3. GitHub
*Settings → Secrets and variables → Actions → **Variables** → New repository variable*:

| Navn | Verdi |
|---|---|
| `PALL_CLIENT_ID` | Application (client) ID |
| `PALL_TENANT_ID` | Directory (tenant) ID |
| `PALL_FILE_URL` | Delingslenken til Excel-filen |

Verdiene er ikke hemmelige, fordi de ikke gir tilgang uten innlogging, men de ligger ikke i koden.
Kjør deretter *Actions → Deploy til GitHub Pages → Run workflow*, eller merge til `main`.

### 4. Første oppstart og mobil
1. Åpne adressen på kontor-PC-en, logg inn og godta tilgangen. Arket «Hendelser» opprettes.
2. På mobil: åpne adressen i Safari/Chrome → Del → **Legg til på Hjem-skjerm**.
3. **Brukere:** Legg til eller fjern brukere både under *Enterprise applications → Users and groups* og i
   delingen av Excel-filen.

Innloggingen fornyes automatisk. Omtrent én gang i døgnet kan appen blinke innom Microsofts
påloggingsside uten at passord trengs. Har økten utløpt midt i arbeidet, sier appen fra at ingenting ble
lagret og viser knappen «Logg inn på nytt».

## Bruk

**Ny pall:** Skriv pallnummeret fra kortet og kontroller verpedato (standard: i dag, eller sist brukte
dato samme dag). Trykk «Flere verpedager?» ved behov. Trykk **200** eller **228** brett (appen husker
siste valg), eller «Annet antall» for en ufullstendig pall. Trykk **Lagre pall**. Lagringen tar vanligvis
2–5 sekunder, og grønn boks betyr at raden er lagret og kontrollert i Excel.

**Levering:** Kryss av pallene, velg butikk (eller «+ Ny butikk»), skriv ordre-/fakturanummer og
kontroller leveringsdato. Trykk **Registrer levering**, kontroller pallnumre og antall brett, og trykk
**Bekreft levering**. Bare paller på lager vises.

**Oversikt:** Søk på pallnummer, ordre-/fakturanummer, butikk og/eller verpedato. Datosøk finner alle
paller der verpeperioden **overlapper** søkeperioden, og én dato alene betyr den ene dagen. Trykk på et
pallnummer for detaljer, rettelser og historikk.

**Rettelser (alltid med årsak, legges til som nye rader i Excel):**

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
   * Kontakt butikken selv, og registrer **«Butikk varslet»** med dato og notat.
   * **Eksporter CSV** (semikolon og UTF-8, åpnes direkte i Excel).

Appen sender aldri meldinger selv.

## Sikkerhetskopi og gjenoppretting

**Automatisk (Microsoft 365):**
* **Versjonslogg:** OneDrive/SharePoint lagrer tidligere versjoner av filen (standard opptil 500).
  Høyreklikk filen → *Versjonslogg* → se hvem som endret når → **Gjenopprett**.
* **Papirkurv:** Slettede filer kan hentes tilbake i 93 dager.
* **Gjenopprett OneDrive/bibliotek:** Hele området kan settes tilbake til et tidspunkt de siste 30 dagene
  (*Innstillinger → Gjenopprett*).

**Manuelt, månedlig (anbefalt):** Åpne filen → *Fil → Lagre en kopi* → mappen `Pallsporing-backup` med
navnet `Pallsporing-ÅÅÅÅ-MM.xlsx`. Ta vare på minst 12 måneder. Kopien er uavhengig av originalfilen.

**Gjenopprette fra en kopi:** Kopier kopien over originalfilen, eller gjenopprett en versjon, og åpne appen.
Den leser alltid hele arket på nytt, så ingen andre steg trengs. Merk at rader som ble registrert etter
kopien, da må registreres på nytt.

**Test gjenoppretting to ganger i året:** Åpne en månedskopi og kontroller at antall rader i «Hendelser» stemmer.

## Utvikling og tester

```bash
cd pallapp
npm install
npm run dev     # http://localhost:8080 – simulert Excel, ingen Microsoft-innlogging
npm test        # 28 automatiske tester
```

I utviklingsmodus kan du bytte bruker med `?bruker=navn@gard.no` i adressen, og data lagres i
`.dev-data.json` (ikke i Git).

Testene dekker blant annet dobbel levering (også 10 samtidige forsøk), duplikat-pallnummer (20
samtidige forsøk), overlappende datosøk (kanttilfeller), rettelser med tidligere verdier, nettverksfeil
før og etter lagring, låst fil, manglende tilgang, Excels typekonvertering, formel-injeksjon, endringer
direkte i arket, sortert ark og tilbakekalling med CSV-eksport.

```
pallapp/
├── public/
│   ├── core.js        # forretningsregler: avspilling av loggen, søk, tilbakekalling, CSV
│   ├── excel.js       # lagring i Excel via Microsoft Graph, kontroll etter lagring
│   ├── auth.js        # Microsoft 365-innlogging (MSAL.js)
│   ├── app.js         # skjermbilder
│   └── index.html, app.css, manifest, ikoner
├── scripts/build.mjs  # bygger dist/ med config.js fra GitHub-variablene
├── scripts/dev.mjs    # lokal utprøving med simulert Excel
└── test/              # automatiske tester og simulert Microsoft Graph
```

Kolonnene i «Hendelser» er: Hendelse-ID, Tidspunkt, Bruker, Hendelse, Pallnummer, Verpet fra,
Verpet til, Brett, Pakkedato, Butikk-ID, Butikk, Telefon, E-post, Ordre-/fakturanr, Leveringsdato,
Levering-ID, Tilbakekalling-ID, Varslet dato, Tekst, Årsak, Tidligere verdier, Gjelder og Sjekksum.
Kolonnerekkefølgen må ikke endres.
