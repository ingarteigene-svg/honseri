# Hønseri — Dagsregistrering

Ein enkel app for å registrere dagleg eggproduksjon og eksportere data til Excel.
Bygd som ein **PWA** (Progressive Web App), så han kan installerast på iPhone og
fungerer også **utan nett**. All data ligg lokalt på telefonen din.

## Funksjonar

- **Ny registrering** — namn (Lars Andreas / Inese / Vasyl), dato (med
  etterregistrering — vald dato som ikkje er i dag markerast tydeleg),
  antall egg (teljar i steg på 30), brett til gardsbutikk, pakking av paller
  (200/228), fôr på silo, vannmålar, døde høner og kommentar. Berre minst
  eitt felt må fyllast ut.
- **Fleirspråkleg** — grensesnittet byter automatisk språk etter kven som
  registrerer: norsk (Lars Andreas), latvisk (Inese), ukrainsk (Vasyl).
  Skjemaet tilpassar seg òg: paller-seksjonen ligg øvst for Vasyl.
- **Logg** — kvar registrering som kort med fargekoda personmerke, dagens
  post utheva. Registreringar kan **redigerast** og **slettast med angre**.
- **Oversikt** — fargetona nøkkeltal-kort og søylevisning av dei siste 10.
- **Eksporter til Excel** — lastar ned ei ekte `.xlsx`-fil (norske kolonnar).
- **Del / send** — på iPhone opnar dette delingsmenyen, så du kan sende Excel-fila
  på e-post, til Filer, AirDrop osv.
- **Automatisk oppdatering** — appen hentar nyaste versjon sjølv når du er på
  nett; ingen reinstallering. Versjonsnummer visast nedst i appen.

## Installere på iPhone

1. Opne app-adressa i **Safari** (sjå «Publisering» under).
2. Trykk **Del**-ikonet (firkanten med pil opp) nedst i Safari.
3. Vel **«Legg til på Hjem-skjerm»**.
4. Appen dukkar opp som eit ikon på heimskjermen og opnar i fullskjerm.

## Publisering (få ei adresse å installere frå)

Appen blir publisert med **GitHub Pages**. Slik slår du det på (éin gong):

1. Gå til repoet på GitHub → **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, vel **Deploy from a branch**.
3. Under **Branch**, vel `claude/egg-production-app-nt4j7i` og mappa `/ (root)`,
   og trykk **Save**.
4. Vent eit minutt eller to. Adressa blir:
   **`https://ingarteigene-svg.github.io/honseri/`**

> ⚠️ Hugs `/honseri/` til slutt — rot-adressa `ingarteigene-svg.github.io`
> gjev «404 File not found».

Opne `https://ingarteigene-svg.github.io/honseri/` i Safari på iPhone og følg
installasjonsstega over.

> Tips: Du kan også teste appen lokalt ved å køyre ein liten webserver i mappa,
> t.d. `python3 -m http.server`, og opne `http://localhost:8000`.

## Korleis data blir lagra

Data blir lagra i nettlesaren (localStorage) på den eininga du brukar — det krev
ingen konto eller internett. Vil du ta vare på data eller flytte dei, brukar du
**Eksporter til Excel** jamleg. Om du tømmer nettlesardata eller avinstallerer
appen, forsvinn registreringane, så eksporter regelmessig.

## Filer

| Fil | Forklaring |
| --- | --- |
| `index.html` | Heile appen (HTML, CSS og JavaScript). |
| `manifest.webmanifest` | PWA-manifest (namn, ikon, farge). |
| `sw.js` | Service worker — gjer at appen virkar offline. |
| `icons/` | App-ikon (192/512 px + apple-touch-icon). |
| `.nojekyll` | Gjer at GitHub Pages serverer filene uendra. |
