# City Simulator – plan

Ett stadsbyggarspel i webbläsaren i stil med SimCity och Cities: Skylines. Det är byggt i 3D, simulerar varje invånare och har utbytbara kulturella teman: först nordiskt, senare sydamerikanskt och fler.

## Beslut

| Område | Beslut | Varför |
|---|---|---|
| Språk | TypeScript överallt | Bygger på befintlig JavaScript-vana. Typerna hjälper i ett stort projekt och med temafilerna. |
| Grafik | 3D med Three.js | Valt framför 2D isometriskt. Kräver instansering och att bara det synliga ritas från start. |
| Simulering | Varje invånare simuleras | Varje invånare har bostad, jobb och dagsschema och gör egna resor. |
| Trafik | Mesoskopisk kömodell | Köer och flaskhalsar uppstår utan att varje bils rörelse simuleras. Se nedan. |
| Trådar | Simuleringen körs i en Web Worker | Skärmen fryser aldrig. Blir simuleringen tung går spelet långsammare i stället. |
| Data | Typade arrayer (struct-of-arrays) | Inga objekt per invånare eller ruta, alltså inga pauser för skräpsamling. |
| Teman | Bara data, aldrig kod. Får på sikt påverka spelet. | Ett nytt tema blir en ny mapp, utan kodändringar. |
| Grafik i början | Platshållare (lådor) | Spelet först, riktig grafik senare. |
| Rust/WebAssembly | Nej, inte nu | Simuleringen är redan snabb nog (se mätningar). Kan bytas senare bakom samma meddelandegränssnitt. |

## Arkitektur

```
┌──────────── Huvudtråd ────────────┐              ┌──────────── Web Worker ─────────────┐
│ UI/HUD (DOM)                      │  kommandon   │ Simulation (ren TS, inga DOM-beroenden)│
│ Three.js: byggnader, vägar, bilar │ ───────────► │  mapgen     – stad, vägnät, zoner   │
│  – ritar bara bilar som syns      │              │  population – invånare, scheman     │
│  – räknar exakt position per      │ ◄─────────── │  scheduler  – händelser per minut   │
│    bildruta från snapshot         │  snapshots   │  traffic    – köer per vägkant      │
│ MapControls (kamera)              │  20/s        │  routing    – vägvalsträd           │
└───────────────────────────────────┘              └─────────────────────────────────────┘
```

- **Kommandon in, ändringar ut.** Huvudtråden skickar bara kommandon, till exempel ändrad hastighet och senare "bygg väg". Simuleringen äger all spelstate.
- **Snapshots** skickas som överförbara buffertar (utan kopiering) och lämnas tillbaka för återanvändning. Varje fordon har sex Float32-fält: kant, körfält, position, fart, köplats och id.
- **Fast tick** på en spelsekund. Workern kör så många tick som hastigheten kräver, inom en tidsbudget per varv.
- **Simuleringen går att testa utan webbläsare.** `Simulation` körs direkt i Vitest.

```
src/
  shared/   config, protocol (meddelanden), rng
  sim/      worker, sim, mapgen, graph, routing, heap, scheduler, traffic, population (+ tester)
  render/   scene, roads, buildings, vehicles
  ui/       hud
```

## Simuleringen i tre detaljnivåer

| Nivå | Gäller | Vad som räknas | Var |
|---|---|---|---|
| Beslut | Alla invånare | Bostad, jobb, avresetider och färdmedel | Worker, bara när något händer (händelsekö per minut) |
| Trafikflöde | Alla vägar | Varje bil är en plats i en kö per vägkant | Worker, varje tick |
| Synlig rörelse | Bara det som syns | Exakt position och rotation för varje bil | Huvudtråden, per bildruta |

**Trafikmodellen** följer samma princip som MATSim:s kösimulering:
- En bil kan lämna en vägkant tidigast efter kantens fria restid.
- Varje kant släpper ut högst 0,5 bil per sekund och körfält.
- En bil kör bara in på nästa kant om det finns plats där (7,5 meter per bil). Fulla vägar bygger därför köer bakåt genom korsningarna.
- En bil som stått först i kön i 60 sekunder släpps vidare ändå. Det förhindrar total låsning.

**Vägval:** för varje destination räknas ett träd ut med omvänd Dijkstra. Trädet säger vilken kant man ska ta från varje korsning.
- Alla som ska till samma ställe delar trädet.
- Träden räknas om löpande med aktuella köer, så bilar väljer om väg mitt under resan.

**Kollektivtrafik** simuleras som restid: väntetid plus avstånd delat med snittfart. Den syns inte som fordon än.

## Temasystemet (planerat)

```
themes/nordic/
  gameplay.json   ← laddas av simuleringen: byggnadstyper (storlek, kapacitet, föroreningar),
                    vilka spelmoduler som är på och deras parametrar
  visual.json     ← laddas av renderingen: vilka modeller eller regler som används för varje byggnadstyp
  assets/
```

- **Simuleringen vet aldrig hur något ser ut.** Den känner bara till typer som `res.high.3`.
- **Spelmekanik är allmänna moduler i motorn** (årstider, cykelandel, uppvärmning och så vidare). Temat slår på dem och ställer in dem. Kräver ett tema något nytt byggs en ny allmän modul.
- **Temafiler kontrolleras mot ett schema när de laddas.** Ett kontrollskript kräver att varje byggnadstyp har grafik.
- **Sparfiler innehåller temats id och version.**
- **Spelregler gäller för hela staden.** Utseendet kan väljas per stadsdel.
- **Riktig grafik genereras helst från regler per tema** (taktyp, fasadfärg, fönstermönster) i stället för handmodellerade hus. Det gör varje nytt tema billigt.
- `SimConfig.carShare` är första kandidaten att flytta in i `gameplay.json`.

## Mätningar (fas 0)

Uppmätt 2026-10-03 på en 256×256-karta (4 km × 4 km, 1 294 korsningar, 4 566 vägkanter, ca 41 000 byggnader).

**Simuleringen ensam** (Node, en tråd):

| Invånare | Bilandel | Bilar på väg (topp) | ms/tick i rusning | Snittrestid bil |
|---|---|---|---|---|
| 100 000 | 40 % | ~1 100 | 0,14 | 2,6 min |
| 400 000 | 60 % | ~21 000 | 0,21 | 11 min (köer) |
| 1 000 000 | 70 % | ~340 000 | 0,53 | 40+ min (total stockning) |

**I webbläsaren** (den här Macen, 120 Hz-skärm, i 60× hastighet):
- 100 000 invånare: 120 fps och 0,14 ms per tick.
- 1 000 000 invånare och 355 000 bilar på vägarna, helt utzoomat med 269 000 bilar i bild: fortfarande 120 fps i snitt, sämsta bildruta 16,6 ms, och 1,0–1,2 ms per tick.

**Slutsats:** varken simuleringen eller ritningen är en flaskhals vid målet 100 000 invånare. Svagare datorer behöver mätas separat. Den troliga gränsen där är uppladdningen av bilarnas positioner till grafikkortet när väldigt många bilar syns.

## Milstolpar

- [x] **Fas 0 – Prestandaprototyp.** 3D-karta, slumpat vägnät, 100 000 pendlande invånare, trafikvy, HUD med mätvärden.
- [ ] **Fas 1 – Bygga själv.** Börja från tom karta. Verktyg för att dra vägar, lägga zoner (bostad, handel, industri) och riva. Vägnätet ändras under spelets gång, vilket kräver inkrementell graf och att vägvalsträd ogiltigförklaras. Kommandon från UI till worker.
- [ ] **Fas 2 – Tillväxt och ekonomi.** Efterfrågan per zontyp. Byggnader växer och förfaller efter markvärde, tillgänglighet och efterfrågan. Skatter, budget, inflyttning och utflyttning.
- [ ] **Fas 3 – Försörjning och service.** El och vatten (nät som flood fill), polis, brandkår och skola med täckningsområden. Kartlägen som visar till exempel täckning och föroreningar.
- [ ] **Fas 4 – Temasystem och nordiskt tema.** gameplay.json och visual.json med schema. Byggnader genererade från regler. Årstider och snö som första spelmodul.
- [ ] **Fas 5 – Spara och ladda.** IndexedDB. Sparfilen innehåller tema-id och version.
- [ ] **Fas 6 – Fler färdmedel.** Kollektivtrafik som syns (busslinjer), cykel och gång.
- [ ] **Fas 7 – Sydamerikanskt tema.**

## Kända begränsningar och risker

- **Vägvalsträdens minne växer med antalet korsningar i kvadrat.** Vid 256×256 är det ca 6,7 MB, vid 512×512 ungefär 100 MB. Större kartor kräver hierarkiskt vägval: kluster av korsningar med träd mellan klustren. Därför är `grid` begränsad till 512.
- **Korsningar saknar egen kapacitet.** Det finns inga trafikljus, svängfiler eller väjningsregler. Flaskhalsar finns bara per vägkant.
- **Alla invånare pendlar** bostad → jobb → bostad. Det finns inga barn, pensionärer, ärenden eller fritidsresor.
- **Det första vägvalsträdet för en destination räknas ut när det behövs.** Det ger enstaka tick på 30–90 ms i början av första rusningen. Det märks inte i bild eftersom simuleringen går i en egen tråd, men träden kan räknas ut i förväg om det behövs.
- **Uppladdningen till grafikkortet** är 64 byte per synlig bil och bildruta. Behövs det kan det minskas till 12 byte med egna instansattribut och en enkel shader.

## Köra

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest – simuleringskärnan
npm run build    # typkontroll + produktionsbygge
```

URL-parametrar för stresstest: `?pop=1000000&cars=0.7&seed=7&grid=128`

Kontroller: dra för att panorera, högerdra för att rotera, scrolla för att zooma. Mellanslag pausar. Tangent 0–5 väljer hastighet och T växlar trafikvyn.
