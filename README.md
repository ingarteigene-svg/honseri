# Klokkargarden – gårdsapper

To mobil-PWA-er for Klokkargarden, Hareid, publisert med GitHub Pages:

| App | Mappe | Adresse |
|---|---|---|
| 🥚 **Hønseri** – daglig eggregistrering med Regneark-synk | `eggapp/` | `https://ingarteigene-svg.github.io/honseri/` |
| 🚜 **Gjødsel** – journal for hønsegjødselleveringer (§ 27) med OneDrive/Excel-synk | `gjodselapp/` | `https://ingarteigene-svg.github.io/honseri/gjodsel/` |

Begge bruker samme EGGLY-designspråk (mørk navy, emoji-fliser) og fungerer offline.
Publisering skjer automatisk via `.github/workflows/deploy.yml` ved push til `main`.

Se `gjodselapp/README.md` for oppsett av OneDrive-synkronisering (Azure) og detaljer.

`hønseri (1).html` er den opprinnelige enkeltfil-versjonen av egg-appen (beholdt som arkiv).
