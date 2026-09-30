# Hønseri – eggregistrering (Cloudflare)

Samme Hønseri-app som før, men med **felles database** for alle telefonene, **innlogging per
person** og **ekte push-varsel kl. 17** når egg ikke er registrert. Løsningen er bygget på
samme måte som Pallsporing, men er **helt adskilt** fra den: egen Worker, egen database og
egen innloggingsliste. Den deler bare Cloudflare-kontoen og API-tokenet.

Alt dere er vant til er med: språk per person (norsk, latvisk, ukrainsk), paller øverst for
Vasyl, egg-teller i steg på 30, redigering, sletting med angre, oversikt, Excel-eksport og
timer arbeidet. Appen virker også uten nett.

## Løsning og kostnader

| Del | Tjeneste | Pris |
|---|---|---|
| App og API | Cloudflare Workers (Worker «honseri») | Gratis: 100 000 forespørsler/døgn |
| Database | Cloudflare D1 («honseri», Vest-Europa) | Gratis: 5 GB |
| Innlogging | Cloudflare Access, samme team som Pallsporing | Gratis opptil 50 brukere |
| Varsel kl. 17 | Cron-trigger i Workeren + Web Push | Gratis |
| Kode og test | GitHub + GitHub Actions | Gratis |

**Løpende kostnad: 0 kr** ved normal bruk.

## Oppsett (én gang, ca. 15 min, bare i nettleseren)

Cloudflare-kontoen og API-tokenet fra Pallsporing gjenbrukes, så det trengs ingen nye nøkler
for publisering.

**Del A – Publisering (skjer automatisk)**
Når denne mappen ligger i `main`, publiserer GitHub appen og oppretter databasen `honseri`
selv. Du ser kjøringen under *Actions* → *Hønseri (Cloudflare) – test og publisering*.
Adressen blir `https://honseri.<ditt-subdomene>.workers.dev`, for eksempel
`https://honseri.klokkargarden.workers.dev`. Appen avviser alle data til del B er gjort.

**Del B – Innlogging (Cloudflare Access)**
1. dash.cloudflare.com → *Workers & Pages* → **honseri** → *Settings* → *Domains & Routes* →
   ved *workers.dev*: **Enable Cloudflare Access**.
2. **Manage Cloudflare Access** → rediger policyen: *Include* → *Emails* → legg inn e-postadressen
   til hver som skal bruke appen, for eksempel deg, Inese, Vasyl og Lars Andreas. Fjern andre regler.
   Sett *Session duration* til 30 dager, så slipper dere å logge inn ofte.
   Listen er egen for Hønseri. Den påvirker ikke hvem som har tilgang til Pallsporing.
3. Kopier **Application Audience (AUD) Tag**: Zero Trust → *Access* → *Applications* → honseri.
4. GitHub → *Settings* → *Secrets and variables* → *Actions* → **New repository secret**:
   `HONSERI_ACCESS_AUD` = AUD-taggen. Hemmeligheten `ACCESS_TEAM_DOMAIN` finnes allerede fra
   Pallsporing. Mangler den, legg inn teamdomenet, for eksempel `klokkargarden.cloudflareaccess.com`.
5. *Actions* → *Hønseri (Cloudflare) – test og publisering* → **Run workflow**.
6. **Test:** Åpne adressen i et privat nettleservindu. Du skal få en innloggingsside med
   engangskode på e-post. En adresse som ikke står i policyen, skal avvises.

**Del C – På hver telefon**
1. Åpne adressen i **Safari**, logg inn med engangskoden, og velg **Del → Legg til på Hjem-skjerm**.
2. Åpne appen fra hjemskjermen. Logg inn på nytt hvis den spør.
3. Trykk **⚙️** → *Varsel kl. 17* → **Slå på**, og godta varsler. Trykk **Send testvarsel** for å
   sjekke at det kommer frem. På iPhone krever varsler iOS 16.4 eller nyere, og at appen er
   åpnet fra hjemskjermen.

**Del D – Flytt de gamle registreringene**
I den gamle appen ligger registreringene på hver enkelt telefon. Velg én av disse kildene:

* **Brukte dere Google-arket?** Åpne arket → arkfanen *Data* → *Fil* → *Last ned* → *CSV*.
  Les inn den ene fila.
* **Ellers:** I den gamle appen på hver telefon: *Logg* → **Excel**, og lagre fila.

I den nye appen: **⚙️** → *Flytt frå den gamle appen* → **Vel fil**. Registreringer som allerede
finnes, hoppes over, så det gjør ingenting om samme fil leses inn to ganger. Bruk enten
Google-arket eller Excel-filene, ikke begge. De gamle Excel-filene har ikke ID-er, så samme
registrering fra begge kildene blir to rader.

Når alt er flyttet og alle bruker den nye appen, kan den gamle Hønseri-appen legges bort.

## Slik fungerer det

* **Felles logg:** Alle registreringer lagres i databasen. Telefonen holder en kopi, så
  appen åpner og viser data også uten nett.
* **Uten nett:** Nye registreringer, endringer og slettinger legges i en kø og sendes i riktig
  rekkefølge når nettet er tilbake. En linje øverst viser hvor mange endringer som venter.
* **Innlogging utløpt:** Appen viser en rød linje med knappen **Logg inn**. Endringer som venter,
  blir ikke borte, og sendes etter innloggingen.
* **Hvem som registrerer:** Personvalget i appen styrer språk og rekkefølge som før, og hver
  telefon husker valget. I tillegg lagres e-postadressen til den som er logget inn.
* **Varsel kl. 17:** Workeren sjekker hver dag kl. 17 norsk tid om det er registrert egg i dag.
  Mangler det, får alle telefoner med varsel på et push-varsel på sitt språk, også når appen er
  lukket. Det sendes maks ett varsel per dag. Telefoner som har slått av varsel, fjernes automatisk.

## Hvordan dataene er sikret

* **Ingenting slettes for godt.** «Slett» i appen merker registreringen som slettet og kan angres.
  Databasen blokkerer sletting.
* **Revisjonslogg:** Hver ny registrering og hver endring skrives automatisk til `audit_log`
  med hvem, når og gamle og nye verdier. Loggen kan ikke endres.
* **Regler i databasen:** Tall kan ikke være negative, egg, brett, paller og døde må være hele tall,
  timer maks 24, og en registrering kan ikke være tom. Dato kan ikke være frem i tid.
* **Innlogging:** Workeren kontrollerer Access-tokenet kryptografisk. Uten oppsett avvises alt.
* **Varsel:** Innholdet krypteres til den enkelte telefonen, så push-tjenesten ikke kan lese det.

## Sikkerhetskopi

**Lag 1 – automatisk:** Cloudflare D1 kan settes tilbake til et hvilket som helst minutt de siste
7 dagene (*Time Travel*), uten oppsett.

**Lag 2 – månedlig Excel-kopi:** *Logg* → **Excel**, og lagre fila i OneDrive.

**Lag 3 – full kopi fra PC** (krever [Node.js 22](https://nodejs.org)):
```bash
cd honseri/eggregistrering
npm install
npx wrangler login          # eller lag .env.prod fra .env.prod.example
npm run backup              # → backup/honseri-ÅÅÅÅ-MM-DD-TT-MM.sql
```
Ikke legg sikkerhetskopier i GitHub. Mappen `backup/` er i `.gitignore`.

## Utvikling og tester

```bash
cd eggregistrering
npm install
cp .dev.vars.example .dev.vars   # lokal testbruker, virker bare på localhost
npm run dev                      # http://localhost:8787 med lokal database
npm test                         # 23 automatiske tester
```

Testene kjører mot en ekte lokal Worker med egen database, og dekker lagring, validering,
redigering med revisjonslogg, myk sletting og angre, sletteforbud, import uten duplikater,
vern mot skriving fra andre nettsteder, push-kryptering kontrollert mot en uavhengig
referanseimplementasjon, VAPID-signatur, og påminnelsen kl. 17 med språk per telefon.

```
eggregistrering/
├── migrations/0001_init.sql   # tabeller, regler og revisjonslogg
├── src/index.js               # API og påminnelse kl. 17
├── src/push.js                # Web Push (kryptering og VAPID) uten eksterne bibliotek
├── src/auth.js                # kontroll av Cloudflare Access-token
├── public/                    # appen (HTML, service worker, ikon)
├── scripts/prod.mjs           # npm run deploy / npm run backup
├── test/                      # automatiske tester
└── wrangler.toml              # konfigurasjon uten hemmeligheter
```

Endringer i databasestrukturen gjøres med en ny fil, `migrations/0002_….sql`. Publiseringen
kjører den automatisk.
