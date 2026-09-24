> **TEMPORÄR – ENDAST FÖR TEST.** Första utkast sammanställt enbart från sökutdrag; källdokumenten kunde inte öppnas. Får inte användas för riktiga beräkningar. Ska göras om mot originalkällorna och granskas.

# Materialbibliotek – startförslag för värmeförlustberäkning (EN 12831 / EN ISO 6946)

Utkast för granskning av VVS-ingenjör. Datum: 2026-09-24.

## Läs detta först (metod och begränsningar)

- **WebFetch var blockerat** för i princip alla källdomäner (boverket.se, energihandbok.se, byggipedia.se, se.weber, cibse.org, diva-portal.org, episcope.eu, slunik.slu.se m.fl.). Alla värden märkta **[S]** kommer därför från **utdrag i sökresultat** (WebSearch), inte från att jag har läst hela dokumentet. Kontrollera därför de viktigaste värdena mot originalkällan innan de tas i bruk.
- **[S]** = värdet stod i ett sökutdrag som kunde kopplas till den angivna URL:en.
  **[S?]** = värdet stod i ett sökutdrag, men det gick inte att avgöra säkert vilken av flera träffade sidor det kom från. Den troliga källan anges.
  **[E]** = min uppskattning. Där det står "ISO 10456 (ur minnet)" är värdet vad jag minns från tabell 3 i EN ISO 10456:2007. Det har inte kunnat verifieras online, eftersom standarden är betald ([SIS](https://www.sis.se/en/produkter/construction-materials-and-building/construction-materials/general/sseniso104562007/)). Köp SS-EN ISO 10456 och stäm av.
- Den viktigaste svenska sammanställningen hittades som en SLU-kursbilaga, **"Tabellbilaga – VIM-kontrollerade isolermaterial / Övriga material (praktiskt tillämpbara värden)"**, med källa *Isolerguiden (Swedisol)* och *SBN 1980 Kommentarsamling*: https://slunik.slu.se/kursfiler/TN0258/30276.1011/Tabellbilaga_U-ber.pdf (samma innehåll finns även på https://docplayer.se/229614822-Tabellbilaga-ovriga-material-praktiskt-tillampbara-varden-kalla-isolerguiden-swedisol.html). Den bör hämtas manuellt och läsas i sin helhet. Den innehåller sannolikt fler relevanta äldre material än vad som syntes i utdragen.
- **BABS 1946** (Boverket) innehåller en historisk tabell över värmeledningstal (bl.a. för sågspån, murtegel och kalkbruk): https://www.boverket.se/contentassets/4e14d56168e14bbba074de978b141591/babs-1946.pdf. Den är värdefull för hus från 1900-talets början och mitten och bör läsas manuellt. Jag fick inte ut själva λ-värdena ur utdragen, bara densiteter (fasadmurtegel 1900, tungt murtegel 1800, lättmurtegel 1500 kg/m³).
- Danska DS 418 **Anneks G** har designvärden för *befintliga* konstruktioner vid renovering. Det är en bra jämförelsekälla men betald: https://webstore.ansi.org/preview-pages/DS/preview_M337200CURES.pdf
- λ-värdena ska tolkas som **designvärden** (inte deklarerade λD) för normal fukt i inomhusklimat eller skyddad utomhusmiljö. För tilläggsisolering med moderna produkter ska tillverkarens λD användas, eventuellt med fuktpåslag.

---

## 1. Materiallista

Kolumnen "Densitet" är bara ifylld när densiteten styr λ.

### 1a. Murverk, sten, bruk och puts

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Massivt murtegel (murverk inkl. fogar) | Solid clay brick masonry | Murverk | gammal | **0,60** | – | 120 (½-sten), 250 (1-sten), 380 (1½-sten), 510 (2-sten) mm | "Tegel och betonghålblock 0,60" – SLU Tabellbilaga (Isolerguiden/SBN 80) https://slunik.slu.se/kursfiler/TN0258/30276.1011/Tabellbilaga_U-ber.pdf ; samma λ 0,6 i räkneexempel på https://www.wikitektur.se/wiki/U-v%C3%A4rde | [S] |
| Massivt murtegel, hårdbränt / tungt | Hard-fired dense brick | Murverk | gammal | **0,78** | ~1800–1900 | som ovan | Byggahus-forum som citerar äldre handbok ("vanligt tegel 0,60, hårdbränt 0,78"): https://www.byggahus.se/forum/threads/70-cm-tegelvaeggar.168410/ | [S?] (sekundärkälla) |
| Fasadtegel (massivt, utsatt yttre skikt) | Facing brick, exposed outer leaf | Murverk | båda | **0,77** | ~1700 | 120 mm | Motsvarar BR 443/ISO-praxis för exponerat yttre murskikt. Värdet 0,77 för "clay bricks" syns i sökutdrag kopplade till EN ISO 10456 och CIBSE/BRE BR 443 (https://www.cibse.org/media/wzrjrf3l/conventions-for-u-value-calculations.pdf) | [S?] |
| Håltegel (äldre, ca 20–25 % hål) | Perforated/hollow clay brick | Murverk | båda | **0,45** | ~1200–1400 | 120–250 mm | Ingen svensk källa hittades. Danska Mur & Tag anger för tegel med ~20 % hålvolym 0,29–0,47 (grundvärden, 1200–1800 kg/m³): https://www.mur-tag.dk/projektering/bygningsfysiske-forhold/varmeegenskaber-for-tegl/ | [E] |
| Modern isolerande håltegel / murblock | Modern insulating clay block | Murverk | ny | 0,08–0,12 | – | 250–490 mm | Murverkskonstruktion-kompendiet (LTH, Molnár & Gustavsson): https://lup.lub.lu.se/search/ws/files/88120505/Murverkskonstruktion_kompendium_pdf_upplaga.pdf | [S] (sällsynt i Sverige) |
| Kalksandsten | Calcium silicate brick | Murverk | båda | 1,0 | ~1800 | 120 mm | – | [E] |
| Betonghålblock | Hollow concrete block | Murverk | båda | **0,60** | – | 150–200 mm | SLU Tabellbilaga (se tegel ovan) | [S] |
| Natursten, granit / gnejs | Granite / gneiss | Sten | gammal | **2,8** | 2500–2700 | 400–800 mm (källarväggar, sockel) | ISO 10456 (ur minnet): granit 2,8. Uppmätta värden för granit varierar 1,7–4,0 (https://www.naturalstoneinstitute.org/designprofessionals/technical-bulletins/rvalue/) | [E] |
| Natursten, kalksten | Limestone | Sten | gammal | 1,7 | ~2200 | 300–600 mm | ISO 10456 (ur minnet): "hård kalksten" 1,7 | [E] |
| Natursten, sandsten | Sandstone | Sten | gammal | 2,3 | ~2600 | 300–600 mm | ISO 10456 (ur minnet) | [E] |
| Kalkbruk (murbruk/fog) | Lime mortar | Bruk | gammal | **0,80** | ~1600 | fogar 10–15 mm | ISO 10456 (ur minnet): "lime, sand" 0,80 | [E] |
| Kalkcementbruk (KC) murbruk | Lime-cement mortar | Bruk | båda | **1,0** | ~1800 | fogar | wikitektur-exempel: "bruk λ 1,0": https://www.wikitektur.se/wiki/U-v%C3%A4rde | [S] |
| Cementbruk | Cement mortar | Bruk | båda | **1,0** | ~1800 | – | ISO 10456 (ur minnet): "cement, sand" 1,0. Samma som ovan | [E] |
| Kalkputs | Lime render/plaster | Puts | gammal | **0,80** | ~1600 | 15–25 mm | ISO 10456 (ur minnet) | [E] |
| Kalkcementputs / putsbruk | Lime-cement render | Puts | båda | **1,0** | ~1800 | 10–25 mm | wikitektur-exempel: "1 cm puts … 0,01/1,0": https://www.wikitektur.se/wiki/U-v%C3%A4rde | [S] |
| Gipsputs (invändig) | Gypsum plaster | Puts | båda | 0,40 | ~1000 | 5–15 mm | ISO 10456 (ur minnet): 0,40 vid 1000 kg/m³, 0,57 vid 1300 kg/m³ | [E] |
| Reveteringsputs på vassmatta (putsskikt + vass) | Render on reed mat lathing | Puts | gammal | se kommentar | – | puts ~20–25 mm + vass ~8–10 mm | Ingen λ för vassmatta hittades. Räkna konservativt: putsen som kalkputs λ 0,8, och vasskiktet antingen försummat eller som R ≈ 0,05 m²K/W. Vassmatta beskrivs t.ex. här: https://www.malarkalk.se/produkter/vassmatta/idealmattan | [E] |

### 1b. Betong och lättbetong

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Betong, armerad (svensk praxis) | Reinforced concrete | Betong | båda | **1,7** | ~2400 | bjälklag 160–250 mm, väggar 150–200 mm | "Värmekonduktiviteten för armerad betong är 1,7 W/(mK)" (Byggipedia, sökutdrag): https://byggipedia.se/byggnadsfysik/varme/varmekonduktivitet-och-varmemotstand/ ; SLU Tabellbilaga "betong vinkelrätt armering 1,7" | [S] |
| Betong, armerad (ISO 10456, 1 % stål) | Reinforced concrete 1 % steel | Betong | båda | 2,3 | 2300 | – | ISO 10456 (ur minnet). Det är ett konservativare EU-värde. **Välj ett av de två armerade värdena som standard** (en fråga för granskaren) | [E] |
| Betong, oarmerad normal | Plain concrete | Betong | båda | **1,7** | ~2300 | 100–200 mm | SLU Tabellbilaga / Isolerguiden (betong 1,7). ISO 10456 ger 1,65 (2200) / 2,0 (2400) (ur minnet) | [S] |
| Cementbaserad avjämningsmassa / pågjutning | Cementitious screed / self-levelling compound | Betong | båda | 1,4 | ~2000 | 5–50 mm | Ingen Weber-λ hittades. ISO 10456 har inget eget avjämningsvärde. Värdet är satt i nivå med cementbruk och avrättning | [E] |
| Lättbetong 400 (Ytong/Siporex) | Autoclaved aerated concrete (AAC) 400 | Lättbetong | båda | **0,10** (torr 0,09) | 400 | 150–300 mm | Betongföreningen, "Fråga experten": 0,09/0,12/0,15 torrt, rekommenderar att räkna med 0,10/0,14/0,17 med hänsyn till fukt: https://betongforeningen.se/fraga_experten/2307-2/ | [S] |
| Lättbetong 500 | AAC 500 | Lättbetong | båda | **0,14** (torr 0,12) | 500 | 150–300 mm | Betongföreningen (som ovan) | [S] |
| Lättbetong 600 | AAC 600 | Lättbetong | båda | **0,17** (torr 0,15) | 600 | 150–300 mm | Betongföreningen (som ovan) | [S] |
| Lättbetongmurverk, generiskt (densitet okänd) | AAC masonry, unknown density | Lättbetong | gammal | **0,15** | – | 200–300 mm | Isolerguiden via SLU Tabellbilaga ("lättbetongmurverk 0,15") | [S] |
| Äldre lättbetong 1940–60-tal (tyngre, ofta armerade element) | Older AAC (heavier) | Lättbetong | gammal | 0,17–0,20 | 600–700 | 200–250 mm | Tidig lättbetong var ofta tyngre. Därför används övre delen av Betongföreningens spann | [E] |
| Lättklinkerblock (Leca-block, standard) | Lightweight expanded clay aggregate block | Lättklinker | båda | **0,20** | 725 | 190–290 mm | Weber, Leca Block projekteringsanvisning: https://www.se.weber/files/se/2022-07/projekteringsanvisning_leca_block.pdf ; Isolerguiden "lättklinkerblock 0,200" | [S] |
| Lättklinkerblock, finblock (Leca Block Fin) | Dense LECA block | Lättklinker | båda | **0,40** | 1100 | 100–190 mm | Weber (som ovan) | [S] |
| Lös lättklinker (fyllning) | Loose expanded clay | Lättklinker | båda | **0,10** (<0,11) | ~300 | 100–300 mm | Leca: "<0,11"; Leca Coated 0,095: https://www.leca.se/produkter/leca-lattklinker/coated , https://www.se.weber/leca-produkter/lecar-lattklinker/lecar-coated | [S] |

### 1c. Trä och träbaserade skivor

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Virke, furu/gran (barrträ) | Softwood (pine/spruce) | Trä | båda | **0,13** | ~500 | reglar 45–195 mm, golvbräder 22–28 mm | TräGuiden: "SS-EN 12524: 0,13 vid ~500 kg/m³"; praktiskt värde 0,13–0,14: https://www.traguiden.se/om-tra/materialet-tra/traets-egenskaper-och-kvalitet/termiska-egenskaper1/varmeegenskaper/ | [S] |
| Lövträ / ek (tätt) | Hardwood (oak) | Trä | båda | **0,18** | ~700–800 | parkett 14–22 mm | TräGuiden: "0,18 vid ~800 kg/m³" (samma URL) | [S] |
| Massivträ / timmer / stående plank | Solid timber wall / plank wall | Trä | gammal | **0,13** (praktiskt 0,14 för att täcka fogar och sprickor) | ~450–500 | stående plank 50–75 mm, timmer 120–200 mm | TräGuiden (se virke). Sprickor och luftläckage täcks inte av λ | [S] (λ) / [E] (påslag) |
| KL-trä | Cross-laminated timber | Trä | ny | 0,12–0,13 | ~450–500 | 80–240 mm | TräGuiden KL-trä: https://www.traguiden.se/konstruktion/kl-trakonstruktioner/kl-tra-som-konstruktionsmaterial/1.6-egenskaper/1.6.2-termiska-egenskaper/ | [S?] |
| Spånskiva | Particle board | Skiva | båda | **0,14** | ~600–700 | 12–22 mm | Isolerguiden via SLU Tabellbilaga (spånskivor 0,14) | [S] |
| Hård träfiberskiva (board, masonit) | Hardboard (Masonite) | Skiva | båda | **0,13** | ~1000 | 3–6 mm | Isolerguiden via SLU Tabellbilaga: "träfiberskivor hårda 0,13 (1000 kg/m³)" | [S] |
| Halvhård träfiberskiva | Medium-density fibreboard (old) | Skiva | gammal | **0,08** | ~600 | 6–12 mm | Isolerguiden via SLU Tabellbilaga (0,08 vid 600 kg/m³) | [S] |
| Porös träfiberskiva / asfaboard (asfaltimpregnerad) | Softboard / bitumen-impregnated fibreboard | Skiva | båda | **0,065** | ~250–400 | 12 mm | Isolerguiden via SLU Tabellbilaga (0,065) | [S] |
| Träfiberisolering (skiva/lösull, modern) | Wood-fibre insulation | Isolering | ny | 0,038–0,045 | 50–160 | 50–200 mm | Tillverkarens λD ska användas | [E] |
| Plywood | Plywood | Skiva | båda | 0,13 | ~500 | 9–21 mm | ISO 10456 (ur minnet) | [E] |
| OSB | OSB | Skiva | ny | 0,13 | ~650 | 11–22 mm | ISO 10456 (ur minnet). 0,13 bekräftat i sökutdrag (European Panel Federation): https://europanels.org/the-wood-based-panel-industry/types-of-wood-based-panels-economic-impact/oriented-strand-board/ | [S?] |
| Trägolv / golvbräder | Timber floorboards | Golv | gammal | 0,13 | ~500 | 22–28 mm | som virke | [S] |
| Parkett (ek) | Oak parquet | Golv | båda | 0,18 | ~700 | 14–22 mm | som lövträ | [S] |

### 1d. Lösfyllnad och äldre isolering/fyllning

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Sågspån (packat, med kalk) | Sawdust fill | Isolering | gammal | **0,08** | ~100–200 | väggar 100–150 mm, vindsbjälklag 150–300 mm | Isolerguiden via SLU Tabellbilaga ("sågspån och kutterspån 0,08"). Sökutdrag nämner även ett spann på 0,07–0,10 | [S] |
| Kutterspån | Wood shavings | Isolering | gammal | **0,08** | ~80–120 | 100–300 mm | Isolerguiden via SLU (0,08); Slöjd & Byggnadsvård: "väl packat ≈ 0,08": https://www.slojdochbyggnadsvard.se/kunskap--fakta/material-och-teknik/materialbiblioteket/isolering/ | [S] |
| Sjunkna/fuktiga spån (tillstånd dåligt) | Settled/damp shavings | Isolering | gammal | 0,10–0,12 | – | – | Påslag för sättningar och fukt, lämnas åt granskaren att bedöma | [E] |
| Torv / torvströ (lös) | Peat fill | Isolering | gammal | **0,06** (spann 0,05–0,08) | ~100–200 | 100–200 mm | Sökutdrag från svenska byggnadsvårdssidor: "torv λ 0,05–0,08" (troligen https://hallahus.se/renovera/stommen/isolering/isoleringsmaterial/ eller https://byggnadsvard.se/biobaserad-isolering/ , exakt sida ej verifierad) | [S?] |
| Mossa (drevning/fyllning) | Moss | Isolering | gammal | 0,06 | – | drevning | Inget λ hittades, satt lika med torv | [E] |
| Koksaska / koksslagg (bjälklagsfyllning) | Coke ash / clinker fill | Fyllning | gammal | **0,25** (spann 0,20–0,40) | ~700–1000 | 50–200 mm | **Motstridiga sökutdrag**: 0,20, 0,25 och 0,40 förekom alla, sannolikt ur SLU Tabellbilaga / Isolerguiden. 0,25 är ett mittval. **Måste kontrolleras** mot https://slunik.slu.se/kursfiler/TN0258/30276.1011/Tabellbilaga_U-ber.pdf | [S?] |
| Granulerad masugnsslagg | Granulated blast-furnace slag | Fyllning | gammal | 0,10–0,12 | ~500–700 | 100–200 mm | Sökutdrag (samma osäkra källa som koksaska) | [S?] |
| Lerklining / lerbruk med halm | Clay daub / clay-straw plaster | Puts | gammal | **0,70** | ~1400–1600 | 20–50 mm | Sökutdrag: "lera blandad med halm ≈ 0,70" (källa oklar, troligen Slöjd & Byggnadsvård, Fördjupad materialanalys Lerklining: https://www.slojdochbyggnadsvard.se/siteassets/sob/fordjupad_materialanalys_lerklining.pdf) | [S?] |
| Lätt lerhalm (lerhalmsvägg) | Light clay-straw | Isolering | gammal | 0,15–0,25 | 500–800 | 150–300 mm | Beror starkt på densiteten | [E] |
| Sand / grus (fyllning, torr) | Sand / gravel fill (dry) | Fyllning | båda | 0,70 (torr), 2,0 (fuktig mark) | ~1600–1800 | 50–300 mm | Sökutdrag: torr sand ≈ 0,33–0,41, mättad sand och grus 2,1–2,7 (USGS/forskning). ISO 10456/13370 för mark: sand/grus 2,0 (ur minnet). Ovan jord i bjälklag föreslås 0,70 | [E] |
| Lera (mark) | Clay/silt (ground) | Mark | – | 1,5 | – | – | ISO 13370/10456 (ur minnet) | [E] |

### 1e. Moderna isolermaterial

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Glasull, standard (λ37) | Glass wool, standard | Isolering | ny | **0,037** | – | 45–240 mm | ISOVER Träregelskiva 37: https://www.isover.se/produkter/isover-traregelskiva-37-c600 | [S] |
| Glasull, premium (λ33) | Glass wool, premium | Isolering | ny | **0,033** | – | 45–240 mm | ISOVER UNI-skiva 33: https://www.isover.se/produkter/isover-uni-skiva-33 | [S] |
| Glasull, lösull (vind) | Loose-fill glass wool | Isolering | ny | 0,040–0,045 | – | 200–500 mm | Tillverkarens λD ska användas | [E] |
| Äldre mineralull (1950–70-tal) | Older mineral wool | Isolering | gammal | 0,045 | – | 45–120 mm | Äldre produkter och sättningar. Motiverat påslag | [E] |
| Stenull (λ36–37) | Stone wool | Isolering | ny | **0,036–0,037** | – | 45–240 mm | PAROC eXtra 0,036: https://www.paroc.com/sv-se/products/paroc-extra ; PAROC Solid 0,037: https://www.byggmax.se/stenullsskiva-paroc-solid | [S] |
| Cellplast EPS S80 | EPS S80 | Isolering | ny | **0,038** | – | 50–300 mm | BEWI EPS produktdatablad: https://bewi.com/wp-content/uploads/2021/02/Produktdatablad-BEWI-EPS-2108.pdf | [S] |
| Cellplast EPS S100 | EPS S100 | Isolering | ny | **0,037** | – | 50–300 mm | Sökutdrag (Sundolitt/BEWI): https://www.byggfaktadocu.se/10/resourcefile/12/37/96/Sundolitt_Produktguiden.pdf | [S?] |
| Äldre cellplast (1970–80-tal) | Older EPS | Isolering | gammal | 0,040 | – | 50–100 mm | – | [E] |
| XPS (markskiva) | Extruded polystyrene | Isolering | ny | **0,034** (0,033–0,036 beroende på tjocklek) | – | 50–200 mm | Finnfoam: λu 0,034 mot mark: https://finnfoam.se/produkter/finnfoam-xps/finnfoam-xps300/ ; Styrofoam 0,033–0,036 | [S] |
| PIR (folieklädd) | PIR board | Isolering | ny | **0,022** | – | 50–200 mm | Kingspan Therma: https://www.insulation.kingspan.com/gb/en/business-groups/kingspan-insulation/therma | [S] |
| PUR (sprutad/skiva) | PUR | Isolering | ny | 0,025–0,028 | – | – | – | [E] |

### 1f. Skivor, ytskikt, tätskikt, övrigt

| Namn (sv) | English | Kategori | Era | λ W/(m·K) | Densitet kg/m³ | Typisk tjocklek | Källa | Säkerhet |
|---|---|---|---|---|---|---|---|---|
| Gipsskiva (standard) | Gypsum plasterboard | Skiva | ny (från ~1960) | **0,22–0,25** | ~700–900 | 12,5 mm (ofta 2 × 12,5 mm) | Isolerguiden via SLU Tabellbilaga "gipsskivor 0,22"; Gyproc (GSTE 13 Studio) 0,25: https://www.gyproc.se/produkter/gipsskivor-och-andra-byggskivor/ljudgipsskivor/gyproc-gste-13-studio | [S] |
| Linoleum | Linoleum | Golv | båda | 0,17 | ~1200 | 2–4 mm | ISO 10456 (ur minnet) | [E] |
| Plastmatta (PVC) | Vinyl flooring | Golv | ny | 0,17 | ~1400 | 2–3 mm | ISO 10456 (ur minnet) | [E] |
| Keramiska plattor/klinker | Ceramic tiles | Golv | båda | 1,3 | ~2300 | 8–12 mm | ISO 10456 (ur minnet) | [E] |
| Asfaltpapp / takpapp / bitumen | Bitumen felt | Tätskikt | båda | 0,23 | ~1100 | 1–5 mm | ISO 10456 (ur minnet). Försumbart R, men kan tas med | [E] |
| Byggpapp / plastfolie | Building paper / PE foil | Tätskikt | båda | – (R ≈ 0) | – | <1 mm | Försummas | [E] |
| Glas (soda-kalk) | Glass | Glas | båda | 1,0 | 2500 | 3–6 mm | ISO 10456 (ur minnet). Används inte för fönster: använd Uw i tabell 3 | [E] |
| Stål (balk, konstruktionsstål) | Structural steel | Metall | båda | 50 | 7800 | – | ISO 10456 (ur minnet). Ett sökutdrag nämnde 60 (äldre svensk tabell). Stålbalkar är köldbryggor och ska inte räknas som skikt | [E] |
| Aluminium | Aluminium | Metall | ny | 160 | 2700 | – | ISO 10456 (ur minnet) | [E] |

---

## 2. Ytmotstånd och luftspalter (EN ISO 6946)

### 2a. Värmeövergångsmotstånd Rsi / Rse [m²·K/W]

| Värmeflödesriktning | Exempel | Rsi | Rse | Källa | Säkerhet |
|---|---|---|---|---|---|
| Uppåt | Tak / vindsbjälklag (värme uppåt) | **0,10** | **0,04** | ISO 6946, sammanställning: https://www.u-value.com/blog/how-to-calculate-u-values ; ISOVER U-värdesberäknaren: https://www.isover.se/anvandarmanual-u-vardesberaknaren | [S] |
| Horisontellt (±30° från horisontalplanet) | Väggar, fönster | **0,13** | **0,04** | som ovan | [S] |
| Nedåt | Bjälklag över kall källare eller uteluft | **0,17** | **0,04** | som ovan | [S] |

Regler (ISO 6946, svensk tillämpning):
- Mot **mark**: Rse = 0 (marken hanteras enligt EN ISO 13370). [E: praxis]
- Mot **ouppvärmt utrymme** (källare, vind, trapphus): Rsi används på båda sidor. U multipliceras sedan med temperaturfaktor b eller verklig temperatur enligt EN 12831. [E: praxis]
- **Väl ventilerad luftspalt** (öppningar > 1500 mm²/m, eller /m²): luftspalten och alla skikt utanför den försummas, och Rse sätts lika med Rsi för samma riktning (t.ex. 0,13 för vägg). [S] ISO 6946:2007 via https://cdn.standards.iteh.ai/samples/40968/eef030b005bd4146b90cddaf78c64f06/ISO-6946-2007.pdf
- **Svagt ventilerad luftspalt** (500–1500 mm²/m eller /m²): halva R-värdet från tabell 2b används. Om skikten utanför spalten har R > 0,15 begränsas deras bidrag till 0,15. [S] (öppningsgränserna finns i utdrag ur samma ISO 6946-exempel. Halveringsregeln är [E], ur minnet ur standarden.)
- **Oventilerad luftspalt**: öppningar ≤ 500 mm²/m. [S] (samma källa)

### 2b. Oventilerade luftspalter, ytor med hög emissivitet [m²·K/W]

Källa: ISO 6946:2007 tabell 2 (återgiven i sökutdrag kopplade till https://cdn.standards.iteh.ai/samples/40968/eef030b005bd4146b90cddaf78c64f06/ISO-6946-2007.pdf och https://pdfcoffee.com/iso-6946-pdf-free.html). **[S]**. Mellanvärden interpoleras linjärt.

| Spalttjocklek mm | Uppåt | Horisontellt | Nedåt |
|---|---|---|---|
| 0 | 0,00 | 0,00 | 0,00 |
| 5 | 0,11 | 0,11 | 0,11 |
| 7 | 0,13 | 0,13 | 0,13 |
| 10 | 0,15 | 0,15 | 0,15 |
| 15 | 0,16 | 0,17 | 0,17 |
| 25 | 0,16 | 0,18 | 0,19 |
| 50 | 0,16 | 0,18 | 0,21 |
| 100 | 0,16 | 0,18 | 0,22 |
| 300 | 0,16 | 0,18 | 0,23 |

(Raden för 0 mm är tillagd för interpolering, [E].)

### 2c. Vindsutrymme (ventilerad kallvind), ISO 6946 tabell "Ru"

| Taktyp | Ru m²K/W | Källa | Säkerhet |
|---|---|---|---|
| Tegeltak utan underlagspapp | 0,06 | ISO 6946 (sökutdrag, samma källor som 2b) | [S] |
| Plåt- eller tegeltak med papp/råspont | 0,2 | som ovan | [S] |
| Som ovan med aluminium/lågemissiv yta | 0,3 | som ovan | [S] |
| Tak med råspont och papp | 0,3 | ISO 6946 (ur minnet) | [E] |

Ru läggs till R för vindsbjälklaget när vinden inte modelleras som ett eget ouppvärmt rum.

---

## 3. U-värden för fönster och dörrar (befintliga svenska byggnader)

Värdena gäller hela fönstret (Uw inkl. karm och båge) om inget annat anges.

| Namn (sv) | U W/(m²K) – förslag | Spann | Källa | Säkerhet |
|---|---|---|---|---|
| 1-glasfönster (enkelfönster, en båge) | **5,0** | 4,5–5,8 | Upphandlingsmyndigheten: "Gamla fönster … Uw ca 2,0 till 5,0": https://www.upphandlingsmyndigheten.se/kriterier/bygg-och-fastighet/flerbostadshus-ombyggnad/totalentreprenad/atgarder-for-bevarade-fonster-och-glaspartier-vid-ombyggnad/basniva/ . Enkelfönster ≈ 5 förekommer även i flera fönsterleverantörers utdrag | [S] (övre gränsen) |
| 2-glas, kopplade bågar (1+1), äldre trä | **2,8** | 2,5–3,0 | Hålla hus: "kopplade tvåglasfönster … normalt ca 2,5–3,0": https://hallahus.se/renovera/fonster/byta-fonster/energieffektivisering-av-gamla-fonster/ ; Glasjouren: "ca 2,9": https://www.glasjour.se/hrf_faq/vad-ar-det-u-varde-pa-gamla-och-nya-fonster/ ; Energimyndigheten: tvåglas "runt 3,0": https://www.energimyndigheten.se/effektiv-energianvandning/guider/husguiden-for-dig-som-vill-energieffektivisera-ditt-hus/minska-behovet-av-varme-och-varmvatten/fonster-dorrar/ | [S] |
| 2-glas, kopplade bågar, otäta/dåligt skick | 3,0–3,5 | – | Stocksundet påpekar att 3,5 ibland anges men anser 2,5 mer rimligt: https://www.stocksundet.se/page/om-fonster-u-varden-och-energi | [S] (spann) / [E] (val) |
| 2-glas isolerruta i enkelbåge (1960–80-tal) | **2,9** | 2,7–3,0 | Glasjouren: äldre isolerglasfönster 2,7–1,8. Isolerruta från 1980-talet Ug 2,8–3,0 (fönsterleverantör, sökutdrag) | [S?] |
| 3-glas, kopplade (2+1: kopplad båge med isolerruta) eller lös innerbåge | **1,9** | 1,8–2,0 | Energimyndigheten: vanliga treglasfönster "runt 2,0"; Hålla hus: "strax under 2,0 … kopplade treglasfönster" | [S] |
| 3-glas isolerruta, äldre (1980–90-tal) | **1,8** | 1,6–2,0 | Glasjouren (2,7–1,8 för äldre isolerglas) | [S?] |
| Genomsnitt, fönster i flerbostadshus byggda 1961–75 (BETSI) | 2,35 | – | Sökutdrag som hänvisar till BETSI (Boverket). Exakt källa ej verifierad | [S?] |
| Modernt energiglasfönster (3-glas, lågemission och argon) | **1,1** | 0,8–1,3 | Energimyndigheten: energieffektiva fönster "1,0 eller lägre"; Glasjouren: moderna 3-glas 0,7–1,3 | [S] |
| Modernt fönster (2000–2010-tal, ej toppklass) | 1,3 | 1,2–1,6 | – | [E] |
| Ytterdörr, trä, gammal (massiv/fyllningsdörr, före ~1980) | **2,5** | 2,0–3,0 | Klarfönster: "en dörr från 70- eller 80-talet ofta över 2,0": https://klarfonster.se/blog/u-varde-ytterdorr . Enbart furudörr 2,1 (forumuppgift, svag källa): https://www.byggahus.se/forum/threads/u-vaerde-ytterdoerr.204871/ | [S] (>2,0) / [E] (2,5) |
| Ytterdörr med glasparti, gammal | 3,0 | 2,5–3,5 | – | [E] |
| Ytterdörr, ny, isolerad | **1,0** | 0,7–1,2 | Klarfönster: modern isolerad "runt 1,0 eller lägre", rekommenderat < 1,2 | [S] |
| Entrédörr trapphus (flerbostadshus), äldre glasad trä/stål | 3,5 | 3,0–4,5 | – | [E] |
| Lägenhetsdörr till trapphus, säkerhetsdörr (modern, stål, isolerad) | **1,5** | 0,8–1,8 | Daloc: loftgångsversioner (ytterklimat) från 0,76: https://www.daloc.se/vara-dorrar/loftgangsdorr-daloc-y33-y33u-och-y43-sakerhetsdorr-rc3 . Invändiga lägenhetsdörrar (S43/T33) saknar ofta deklarerat U, så 1,5 är en uppskattning | [S] (loftgång) / [E] (invändig) |
| Lägenhetsdörr till trapphus, äldre trä (före säkerhetsdörr) | 2,0 | 1,8–2,5 | – | [E] |
| Innerdörr (lättdörr/fyllningsdörr, mellan rum) | **2,0** | 1,8–2,5 | Ingen källa hittades. Används bara om rummen har olika temperatur | [E] |
| Källardörr, trä, oisolerad | 3,0 | 2,5–3,5 | – | [E] |
| Källardörr, stål, oisolerad (enkel plåt) | 5,0 | 4,0–5,8 | Oisolerad plåt ≈ 1/(Rsi+Rse) ≈ 5,9 | [E] |
| Källardörr / ytterdörr, stål, isolerad | 1,5 | 1,0–2,0 | – | [E] |

---

## 4. Vanliga historiska sammansatta konstruktioner, typiska U-värden (valfritt)

Egna beräkningar [E] använder λ-värdena ovan och Rsi/Rse ovan. Köldbryggor och inhomogena skikt (reglar och bjälkar) är bara grovt medräknade.

| Konstruktion | Uppbyggnad (typisk) | U W/(m²K) | Källa | Säkerhet |
|---|---|---|---|---|
| 1-stens tegelvägg, putsad | 15 + 250 tegel + 15 mm puts | **1,6** | Egen beräkning: R = 0,13 + 0,04 + 0,25/0,6 + 2·0,015/0,9 ≈ 0,62 | [E] |
| 1½-stens tegelvägg, putsad (~38–40 cm) | puts + 380 tegel + puts | **1,25** | Äldre handbok citerad på Byggahus: "putsad vanlig tegel i kalkbruk, 35 cm, k = 1,25": https://www.byggahus.se/forum/threads/70-cm-tegelvaeggar.168410/ . Egen kontroll: 0,17 + 0,38/0,6 + 0,03 = 0,83 → 1,20. Andra sökutdrag anger ≈1,7 för 35 cm tegel (med λ ≈ 0,77) | [S?] + [E] |
| 2-stens tegelvägg, putsad (~51–54 cm) | puts + 510 tegel + puts | **0,95** | Egen beräkning: 0,17 + 0,51/0,6 + 0,03 ≈ 1,05 | [E] |
| 3-stens tegelvägg (~76 cm, bottenvåning i sekelskifteshus) | – | **0,66** | Samma handboksreferens: "76,5 cm ger k = 0,66" | [S?] |
| Skalmur med oventilerad luftspalt (2 × ½-sten + 60 mm luft) | 120 tegel + 60 luft + 120 tegel + 10 puts | **1,4–1,5** | wikitektur-exempel (samma skikt) → U ≈ 1/(0,13+0,04+0,2+0,12+0,17+0,01) ≈ 1,5: https://www.wikitektur.se/wiki/U-v%C3%A4rde ; Byggahus-utdrag: "30 cm dubbel tegelvägg med luftspalt ≈ 1,5" | [S] |
| Lättbetongvägg 250 mm (densitet 500), putsad | puts + 250 LB + puts | **0,50** | Egen beräkning: 0,17 + 0,25/0,14 + 0,03 = 1,99 | [E] |
| Tegel + lättbetong (1950-talsvägg: ½-sten fasadtegel + 150–200 lättbetong) | 120 tegel + 20 luft/bruk + 200 LB + puts | **0,55–0,65** | Egen beräkning. BETSI-genomsnitt för ytterväggar byggda före 1960: 0,61 / 0,58 / 0,55 (syd/mitt/norr), enligt sökutdrag med hänvisning till BETSI (exakt källa ej verifierad) | [E] / [S?] |
| Regelvägg med sågspån (1900–1940-tal) | panel + papp + 25 bräder + 100–150 sågspån mellan reglar + 25 bräder + puts/tapet | **0,55–0,75** | Egen beräkning: 120 mm spån λ 0,08 → R ≈ 1,5. Med 12 % regelandel λ 0,13 och bräder, papp samt Rsi/Rse blir U ≈ 0,6 | [E] |
| Stående plank 75 mm, panel ute, puts/papp inne | 22 panel (ventilerad) + papp + 75 plank + 20 puts/bräder | **1,1–1,3** | Egen beräkning: 0,13 + 0,13 (vent.) + 0,075/0,13 + ~0,1 ≈ 0,94 → 1,1 | [E] |
| Timmervägg 150 mm | – | **0,7–0,8** | Egen beräkning: 0,17 + 0,15/0,13 = 1,32 → 0,76 (fogar och läckage ej medräknade) | [E] |
| Träbjälklag med blindbotten och koksaska (mot kallvind) | 28 golvbräder + luft + 100 koksaska på 25 mm blindbotten + 20 mm puts på vass (undersida) | **0,9–1,1** | Egen beräkning (fält, värme uppåt): 0,10 + 0,028/0,13 + 0,16 + 0,10/0,25 + 0,025/0,13 + 0,02/0,8 + 0,10 (Rsi-motsvarighet mot vind) + Ru 0,06 ≈ 1,2 → U ≈ 0,85. Bjälkarna (≈10–15 %) höjer värdet. Med koksaska λ 0,40 blir U ≈ 1,05 | [E] |
| Träbjälklag med sågspån 150–300 mm (vindsbjälklag) | – | **0,30–0,50** | Examensarbete (diva-portal): vindsbjälklag med sågspån och blindbotten, U ≈ 0,44: https://www.diva-portal.org/smash/get/diva2:656072/FULLTEXT01.pdf (källan är osäker: utdraget kan komma från https://www.diva-portal.org/smash/get/diva2:631730/fulltext01.pdf) | [S?] |
| Betongbjälklag 160–200 mm, oisolerat (mot kallvind/uteluft) | 180 betong + avjämning + matta | **≈3,5** (uppåt) / ≈3,0 (nedåt) | Egen beräkning: 0,10 + 0,04 + 0,18/1,7 + ~0,02 ≈ 0,27 → 3,7 | [E] |
| Betongbjälklag med 100 mm mineralull/spån på kallvind (1950–60-tal) | 180 betong + 100 isolering (λ 0,045) | **≈0,40** | Egen beräkning: 0,14 + 0,11 + 2,2 → 0,41 | [E] |
| Betongbjälklag mot kall källare (oisolerat) | 160 betong + trä-/parkettgolv på reglar | **≈1,5–2,0** | Egen beräkning (Rsi 0,17 på båda sidor, värme nedåt) | [E] |
| Källarvägg natursten 600 mm ovan mark | – | **≈2,0** | Egen beräkning: 0,17 + 0,6/2,8 = 0,38 → 2,6. Med putsens inverkan ≈ 2,0–2,6. Den del som ligger under mark beräknas enligt ISO 13370 | [E] |

Ingen källa hittades för TABULA/EPISCOPE:s svenska typologi-U-värden. Broschyren finns här och bör läsas manuellt: https://episcope.eu/fileadmin/tabula/public/docs/brochure/SE_TABULA_TypologyBrochure_Mdh.pdf. Samma gäller Boverkets typbyggnader i Energiguiden: https://www.boverket.se/sv/energiguiden/energieffektivisera-flerbostadshus/energirenovera/byggide/klarlagg-forutsattningarna/atgarder-i-typiska-byggnader/

---

## 5. Öppna frågor till granskaren

1. **Armerad betong**: svensk praxis 1,7 eller ISO 10456 2,3/2,5? (Betydelsen är liten för U, men stor för köldbryggor.)
2. **Tegel**: 0,60 (svensk Isolerguiden/SBN-praxis) som standard och 0,77 för utsatta fasadskikt? Eller ett gemensamt värde, t.ex. 0,7?
3. **Koksaska**: sökutdragen var motstridiga (0,20 / 0,25 / 0,40). Kontrollera mot SLU/Isolerguiden-tabellen och BABS 1946.
4. **Fuktpåslag** för gamla organiska fyllningar (spån, torv), t.ex. +25 %?
5. Behövs **ISO 10456-verifiering** (köp av SS-EN ISO 10456:2007) för alla rader märkta "(ur minnet)"?
6. Dörrar mot trapphus: ska appen räkna U × b-faktor (trapphus 10–15 °C) eller behandla trapphuset som en egen zon?
