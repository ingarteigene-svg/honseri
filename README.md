# Klokkargarden – gårdsapper

Mobilapper for Klokkargarden, Hareid. De tre første er publisert med GitHub Pages; Pallsporing, Hønseri (Cloudflare) og Gårdsbutikk kjører på Cloudflare fordi de trenger felles database og innlogging:

| App | Mappe | Adresse |
|---|---|---|
| 🥚 **Hønseri** – daglig eggregistrering med Regneark-synk | `eggapp/` | `https://ingarteigene-svg.github.io/honseri/` |
| 🚜 **Gjødsel** – journal for hønsegjødselleveringer (§ 27) med OneDrive/Excel-synk | `gjodselapp/` | `https://ingarteigene-svg.github.io/honseri/gjodsel/` |
| 📈 **Eggly** – Nortura-avregninger: pris, eggvekt, størrelsesmiks og fôr | `eggly/` | `https://ingarteigene-svg.github.io/honseri/eggly/` |
| 📦 **Pallsporing** – sporbarhet for eggpaller: ny pall, levering, søk og tilbakekalling | `pallapp/` | Cloudflare Workers (egen adresse, krever innlogging) – se `pallapp/README.md` |
| 🥚 **Hønseri (Cloudflare)** – eggregistreringen med felles database, innlogging og varsel kl. 17. Erstatter `eggapp/` når dataene er flyttet | `eggregistrering/` | `https://honseri.<subdomene>.workers.dev` (krever innlogging) – se `eggregistrering/README.md` |
| 🛒 **Gårdsbutikk** – selvbetjent salg med QR-kode, Vipps og kontant: lager, kassaoppgjør og Excel | `gardsbutikk/` | Butikk: `https://gardsbutikk.<subdomene>.workers.dev` (åpen). Admin: `https://gardsbutikk-admin.<subdomene>.workers.dev` (krever innlogging) – se `gardsbutikk/README.md` |

Begge bruker samme EGGLY-designspråk (mørk navy, emoji-fliser) og fungerer offline.
Publisering skjer automatisk via `.github/workflows/deploy.yml` ved push til `main`.

Eggly-tallene (Nortura-avregning) oppdateres ved å redigere `EGGLY_DATA` i `eggly/index.html`
(og «Siste avregning» i `eggapp/index.html`) — dette repoet er nå samlingsstedet; det gamle
`ingarteigene-svg/eggly`-repoet kan arkiveres.

Se `gjodselapp/README.md` for oppsett av OneDrive-synkronisering (Azure) og detaljer.

`hønseri (1).html` er den opprinnelige enkeltfil-versjonen av egg-appen (beholdt som arkiv).
