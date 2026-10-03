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
| Vägar | Fria kurvor (kvadratiska Bézierkurvor) och rutnät | Raka vägar är kurvor utan böj. Kurvorna går att dela exakt där nya korsningar uppstår. |
| Rita vägar | Rak väg, kurva med tre klick, frihand, rutnätsverktyg, fästning mot rutnät | Både precisa och snabba sätt att bygga. |
| Zoner | Celler längs vägarna (8×8 m, fyra rader djupa), som i Cities: Skylines | Följer kurvor. Ersätter fas 0:s rutnät av rutor. |
| Rust/WebAssembly | Nej, inte nu | Simuleringen är redan snabb nog (se mätningar). Kan bytas senare bakom samma meddelandegränssnitt. |

## Arkitektur

```
┌──────────── Huvudtråd ─────────────┐   kommandon   ┌──────────── Web Worker ──────────────┐
│ Verktyg + förhandsvisning          │ ────────────► │ Simulation (ren TS, inga DOM-beroenden)│
│  – planerar mot en spegel av       │  bygg väg,    │  RoadNetwork – vägnätet (sanningen)  │
│    vägnätet med samma kod          │  riv, zona    │  zoning      – zonceller längs vägar │
│ Three.js: vägar, korsningar,       │               │  buildings   – byggnader, jobb       │
│  byggnader, zoner, bilar           │ ◄──────────── │  population  – invånare, scheman     │
│  – ritar bara bilar som syns       │  vägnät,      │  scheduler   – händelser per minut   │
│ UI: verktygsfält, HUD              │  celler,      │  traffic     – köer per vägkant      │
│ MapControls + tangentbord          │  byggnader,   │  routing     – vägvalsträd           │
└────────────────────────────────────┘  snapshots    └──────────────────────────────────────┘
                         delat: shared/geometry, network, roadplan, zones, protocol
```

- **Kommandon in, ändringar ut.** Huvudtråden skickar bara kommandon (bygg väg, riv, zona, ändra hastighet). Simuleringen äger all spelstate och skickar ändringarna tillbaka: hela vägnätet när det ändrats, zoncellerna, nya och rivna byggnader, och trafiken 20 gånger per sekund.
- **Det du ser är det du får.** Vägplaneraren (`shared/roadplan.ts`) körs både i huvudtråden för förhandsvisningen och i workern när vägen byggs. Den fäster vägen mot korsningar och vägar, skapar korsningar där vägar korsar varandra och nekar vägar med för spetsiga vinklar, för skarpa kurvor, för korta sträckor eller för litet avstånd till andra vägar.
- **Stabila id:n i vägnätet, täta index i simuleringen.** `RoadNetwork` har id:n som aldrig återanvänds. Vid varje ändring byggs simuleringens graf om med täta index, och köerna flyttas över (`Traffic.remap`). Bilar på rivna vägar kör ut igen från korsningen de kom ifrån.
- **Snapshots** skickas som överförbara buffertar (utan kopiering) och lämnas tillbaka för återanvändning. Varje fordon har sex Float32-fält: kant, körfält, position, fart, köplats och id.
- **Fast tick** på en spelsekund. Workern kör så många tick som hastigheten kräver, inom en tidsbudget per varv.
- **Simuleringen går att testa utan webbläsare.** `Simulation` körs direkt i Vitest.

```
src/
  shared/   geometry (kurvor), network (vägnätet), roadplan (vägplaneraren), zones, config, protocol, rng
  sim/      worker, sim, demo, graph, routing, heap, scheduler, traffic, zoning, buildings, population (+ tester)
  render/   scene, roads (vägar + korsningar), vehicles, buildings, zones, preview, cameraKeys, meshBuilder
  tools/    controller (verktygen), shapes (frihand, rutnät)
  ui/       toolbar, hud, tooltip
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

## Zoner och byggnader (fas 1)

- **Zonceller** skapas på båda sidor av varje vägsträcka och följer kurvan. Celler som skulle hamna på en väg eller krocka med en äldre vägs celler skapas inte, och inte heller cellerna bakom dem. Därför fylls kvarter snyggt från alla håll.
- **Celler ärver zon och byggnad** när vägnätet ändras runt dem. En ny korsning nollställer alltså inte kvarteren omkring. En byggnad som förlorar någon av sina celler (till exempel när en ny väg dras rakt igenom) rivs.
- **Byggnader växer upp** slumpvis på zonade tomter: 1–2 celler breda och 1–4 djupa. Bostäder ger invånare som flyttar in direkt. Handel och industri ger jobb. I fas 2 ersätts detta av riktig efterfrågan.
- **Rivs en bostad** flyttar invånarna från staden. **Rivs en arbetsplats** blir de anställda arbetslösa och får nya jobb när det finns lediga.

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
- [x] **Fas 1 – Bygga själv.** Tom karta. Raka vägar, kurvor (tre klick), frihand, rutnätsverktyg och fästning mot rutnät. Gator och huvudleder. Riva. Zoner längs vägarna med pensel. Byggnader och invånare som växer upp. Demostaden (`?demo`) byggs med samma verktyg.
- [ ] **Fas 2 – Tillväxt och ekonomi.** Efterfrågan per zontyp. Byggnader växer och förfaller efter markvärde, tillgänglighet och efterfrågan. Skatter, budget, inflyttning och utflyttning.
- [ ] **Fas 3 – Försörjning och service.** El och vatten (nät som flood fill), polis, brandkår och skola med täckningsområden. Kartlägen som visar till exempel täckning och föroreningar.
- [ ] **Fas 4 – Temasystem och nordiskt tema.** gameplay.json och visual.json med schema. Byggnader genererade från regler. Årstider och snö som första spelmodul.
- [ ] **Fas 5 – Spara och ladda.** IndexedDB. Sparfilen innehåller tema-id och version.
- [ ] **Fas 6 – Fler färdmedel.** Kollektivtrafik som syns (busslinjer), cykel och gång.
- [ ] **Fas 7 – Sydamerikanskt tema.**

## Mätningar (fas 1)

Demostaden (`?demo`): 849 korsningar, 1 636 vägsträckor, 55 000 zonceller, 9 600 byggnader, 70 800 invånare och 74 000 jobb.
- Den byggs med verktygen på 0,7 s i workern.
- Simuleringen tar 0,07–0,5 ms per tick.
- Den håller 120 fps.
- En ändring i vägnätet tar cirka 25 ms i huvudtråden: ny spegel cirka 12 ms och ny vägmodell cirka 10 ms.
- Förhandsvisningen planerar en 2 km lång diagonal genom rutnätet på 5–12 ms.

## Kända begränsningar och risker

- **Vägvalsträdens minne växer med antalet korsningar i kvadrat.** 1 300 korsningar ger cirka 7 MB, 5 000 korsningar cirka 100 MB. Riktigt stora städer kräver hierarkiskt vägval: kluster av korsningar med träd mellan klustren.
- **Alla vägvalsträd räknas om efter varje ändring i vägnätet.** I en stor stad mitt i rusningen ger det en kort topp i simuleringen. Den syns inte i bild, men spelet går långsammare en stund. Träden kan behållas och räknas om i bakgrunden om det blir ett problem.
- **Vägnätets spegel och 3D-modell byggs om helt vid varje ändring** (cirka 25 ms i demostaden). Görs stegvis om städerna blir mycket större.
- **Byggnader växer upp utan efterfrågan, och det finns inga pengar ännu.** Kommer i fas 2.
- **Marken är platt.** Det finns inga höjder, broar eller tunnlar, och korsningar har ingen vägmålning.
- **Det går inte att uppgradera vägar.** För att byta gata mot huvudled måste man riva och bygga om.
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

URL-parametrar: `?demo` startar med en färdigbyggd stad, `cars=0.6` ändrar bilandelen och `seed=7` ändrar slumpen.

**Kamera**
- Med Välj-verktyget panorerar man genom att dra.
- I byggläge är vänster musknapp verktyget. Man panorerar med mitten-dra, Shift + dra eller WASD/piltangenterna.
- Högerdra eller Q/E roterar. Scroll zoomar.

**Bygga**
- Rak väg: klicka start och slut. Vägen fortsätter från slutet.
- Kurva: klicka start, böjpunkt och slut.
- Frihand: håll nere och rita.
- Rutnät: dra en rektangel.
- G växlar fästning mot rutnät. B väljer rivning.
- Esc eller högerklick avbryter ett pågående bygge.

**Tid och vy:** mellanslag pausar, tangent 0–5 väljer hastighet och T växlar trafikvyn.
