# Morphoid Studio – decyzje techniczne i roadmapa PoC

## 1. Dobór narzędzi (i dlaczego)

| Warstwa | Wybór | Uzasadnienie |
|---|---|---|
| Język / build | **TypeScript (strict) + Vite** | Najszybszy cykl dev, natywne Workery (`new Worker(new URL(...))`), zero konfiguracji. |
| Testy | **Vitest** | Ten sam transformer co Vite. Logika (DNA, rig, menu) jest czysta, więc testy są szybkie i bez DOM. |
| Stan | **Własny mini-store** (`src/core/store.ts`), do owinięcia w Zustand | Core bez zależności od frameworka. UI podpina się przez `subscribe`/`getState`. |
| UI shell | **React (tylko panele)** | Lewa/prawa kolumna, belka, landing. **Canvas 2D i scena 3D są poza Reactem**, sterowane pętlą `requestAnimationFrame`. |
| Render 2D | **SVG z mutacją atrybutów** (nie `innerHTML`) | Makieta przebudowuje stringi co klatkę, co daje GC i layout thrash. Docelowo: stała liczba `<path>`, aktualizowane `setAttribute('d')` tylko gdy zmienił się rig lub trwa animacja. Hit-testing i eksport rysunku za darmo. |
| Render 3D | **Three.js** | Standard. Podgląd = ta sama siatka co bake, w niskiej rozdzielczości (pkt 3). |
| Geometria | **SDF + Surface Nets, TypeScript w Workerze, typed arrays** | WASM dopiero po profilowaniu. Najpierw `Float32Array` + wąskie pasmo (narrow band). |
| Walidacja siatki | **Własny walidator po bake** | Gwarancja manifold wynika z walidatora, nie z samego algorytmu. |
| 3MF / ZIP | **fflate** (lub JSZip) | fflate jest mniejszy i szybszy. 3MF to ZIP z XML. |
| Hosting | **Cloudflare Pages / Vercel** | 100% po stronie klienta. Statyczny build. |

## 2. Kluczowe decyzje architektoniczne

1. **Genom jest jedynym mutowalnym stanem.** Kod `MPH…`, rig, podgląd 2D i 3D są pochodnymi (`solveRig` jest czystą funkcją z cache per kod).
2. **Jedno źródło geometrii 3D zamiast dwóch silników.** Rezygnuję z osobnych siatek low-poly i silnika SDF. Podgląd i eksport to *ta sama funkcja* SDF, próbkowana grubo (ok. 1 mm voxel, ok. 60³ komórek) lub drobno (0,15–0,2 mm). Zalety: podgląd odpowiada wydrukowi, każdy klocek tworzymy raz, a przestrzeń stanów jest dyskretna, więc wyniki cache'ujemy per klocek.
3. **Pozycje w mm, nie w pikselach.** Rig pracuje w mm (+X przód, +Y góra, Z lateralnie, Y=0 stół). Rzut 2D to tylko `project2D` (z opcją lustra, bo makieta ma stwora zwróconego w lewo).
4. **Deterministyczność.** Losowanie i mutacja przyjmują seed (`mulberry32`), więc „Losuj" jest odtwarzalne.
5. **Menu kołowe jako automat stanów** (`reduceMenu`): bez DOM, bez timerów, w pełni testowalne. Zero-Travel Undo jest *gwarantowane geometrycznie*: przycisk WSTECZ jest centrowany na kącie kliknięcia, na tych samych promieniach pierścienia.

## 3. Budżety wydajności (kryteria akceptacji)

- `solveRig`: < 0,1 ms (cache hit: ~µs). Test regresji: 3000 losowych genomów.
- Klatka 2D: brak alokacji stringów w pętli. Aktualizacja `d` tylko dla zmienionych ścieżek.
- Podgląd 3D po zmianie klocka: gruby bake w Workerze < 150 ms, a UI w tym czasie działa na poprzedniej siatce (z crossfade). Nigdy nie blokujemy wątku głównego.
- Eksport (0,2 mm): < 3 s dla typowej figurki, z paskiem postępu i możliwością anulowania.
- Pamięć: pole SDF liczone w pasmie wokół powierzchni, bez gęstej siatki 300³.

## 4. Etapy

**Etap 0 – rdzeń (ZROBIONE w tym commicie)**
Genom 13 bajtów + CRC-4, rig z kotwicą Y=0, reguła N→2N, automat menu kołowego, store z historią, 23 testy.

**Etap 1 – Edytor 2D (ZROBIONE)**
- Vite + React shell z layoutem makiety (belka, kolumna lewa/prawa, centrum).
- Renderer SVG czytający `solveRig` i `project2D`, sockets z `SOCKET_NODE`.
- Binding menu kołowego (kąt wskaźnika → `pick/back`), oddech z `idleOffsets`, wstrzymanie idle przy otwartym menu (żeby gniazda nie drżały).
- Pasek DNA: kopiuj, wklej (`parse`, ostrzeżenie przy złej sumie kontrolnej), `?code=` w URL.
- *Kryterium:* zmiana dowolnego klocka aktualizuje kod DNA, a wklejenie kodu odtwarza scenę 1:1.
- *Zrealizowane odstępstwa:* jeden ekran z przełącznikiem `2D | 3D` (zatwierdzone), motyw jasny/ciemny do wyboru (domyślnie wg systemu, zapamiętany), bez dźwięków. Pole `legs.count` zostaje w genomie, ale nie ma jeszcze kontrolki, bo rig nie rozróżnia 2 i 4 nóg. Suwaki skokowe 2N działają już w trybie 3D, więc część Etapu 2 jest wcześniej gotowa.
- *Styl rysunku:* figurkowy (decyzja: narzędzie dla amatorów). Kolorowe, obłe sylwetki wypełnione kolorami z palety DNA (c1 ciało, c2 akcenty, c3 wzory), obrys w kolorze atramentu, duże oczy z odblaskiem, cień na stole, ukryta druga para nóg, wzory ciała (pręgi, cętki), obroża i siodło. Kości riga są domyślnie wyłączone (przełącznik zostaje). Sylwetki są parametryczne (elipsy, tuby, wielokąty), więc szlif artystyczny wariantów pozostaje osobnym zadaniem.

**Etap 1b – Kontrola druku (ZROBIONE)**
Kontrakt elementu 2D↔3D↔druk (`docs/ELEMENT_CONTRACT.md`), audyt sylwetki bez podpór, profil Bambu Lab P1S, plan druku (Całość / Moduły / własny) poza DNA, panel „Kontrola druku" z akcjami i znacznikami na rysunku, testy egzekwujące zasadę (34 testy). Podpory są ustawieniem (domyślnie dozwolone), więc tułów jest okrągły i kształt nie jest wypaczany pod druk. Aplikacja ostrzega po zmianie, która zwiększa potrzebę podpór (komunikat z propozycją rozbicia lub cofnięcia). Elementy zaprojektowane pod druk: klin podbródka, ogon unoszony pod kątem, skrzydła w „piłę", płaskie zęby, wąsy jako osobna część z płytką na czop.

**Etap 2 – Viewport 3D (ZROBIONE)**
- Three.js z tym samym `Rig`. Na początek prymitywy (elipsoidy/kapsuły) na węzłach, bez SDF.
- Suwaki skokowe 6-pozycyjne i przełączanie klasy w 2D przy przekroczeniu progu.
- *Kryterium:* suwak 3D zmienia rysunek 2D i odwrotnie (spójność obu kierunków).
- *Zrealizowane:* Three.js na tym samym rigu i tych samych konturach w mm (wyciągnięcie w osi Z z zaokrągleniem, części parzyste lustrzane, wzór ciała malowany na tułowiu). `core/art/spec3d.ts` to tabela 3D dla każdego slotu 2D, a `tests/art3d.test.ts` wymusza pełne pokrycie (to on wykrył brak ogona). Widok rozłożony pokazuje części drukowane osobno i czopy, mały podgląd 3D jest w trybie 2D, widok na stole P1S. To jest podgląd z wyciągniętych sylwetek, a nie końcowa bryła: gładka, szczelna bryła powstanie w silniku bake (Etap 3).

**Etap 3 – Bake Engine (ZROBIONE, bez czopów i 3MF)**
- SDF: kapsuły/elipsoidy po kościach plus `smin`. Najpierw tułów + głowa + 4 łapy ze stopą płaską na Y=0.
- Surface Nets w Workerze, walidator (parzystość krawędzi, jedna powłoka, objętość > 0, min. grubość, płaska stopa o wymaganej powierzchni).
- Analiza nawisów (kąt > ~45° → ostrzeżenie), aby „bez podpór" było sprawdzane, a nie zakładane.
- Eksport `.stl` (binarny). Strojenie tabel `dimensions.ts` na prawdziwych wydrukach.
- *Kryterium:* 100% losowych genomów z puli testowej przechodzi walidator, 10 figurek wydrukowanych bez podpór.
- *Zrealizowane:* `core/bake`: pole SDF z dokładnych odległości do konturów (wyciągnięcie w Z z zaokrągleniem, jak w podglądzie 3D), zrost `smin` (promień 1,2 mm), Surface Nets, **naprawa topologii przed siatkowaniem** (każda komórka ma połączone rogi wewnątrz i na zewnątrz, więc siatka się nie „zaciska"), walidator (każda krawędź dokładnie raz w każdym kierunku, objętość, liczba powłok), STL binarny, Web Worker z postępem i anulowaniem, orientacja do druku (stojące zostają, płaskie kładą się na stole), eksport STL lub ZIP części. Testy: kula (objętość ±3%), domyślny stworek w jednej szczelnej powłoce, 25 losowych w trybie całość i modułowym, STL, orientacja.
- *Pomiary (domyślny stworek):* szkic 0,6 mm ok. 0,5 s i 44k trójkątów, standard 0,3 mm ok. 3,5 s i 177k trójkątów (8,8 MB), dokładny 0,2 mm ok. 10 s i 400k trójkątów (20 MB). Budżet „< 3 s przy 0,2 mm" nie jest spełniony: wąskie gardło to pełne skany siatki, do optymalizacji w paśmie przy powierzchni.
- *Jeszcze nie ma:* czopów i gniazd jako geometrii (części modułowe są szczelne, ale bez złączy), elementów cieńszych niż 0,8 mm (źrenice, usta, brwi, wnętrze ucha), które mają być obszarami koloru w 3MF, oraz 3MF (Etap 4).

**Etap 4 – Części, kolory, dopracowanie (do zrobienia)**
- Czopy/gniazda w domenie SDF (`max(a, -b)`), luz 0,2 mm konfigurowalny. Orientacja i układ części na stole.
- `.3mf` wielomateriałowy: **spike na Bambu Studio i PrusaSlicer jako pierwszy krok etapu**, bo mechanizmy podziału na kolory są specyficzne dla slicera.
- Pozostałe klocki z katalogu (krest, coat, accessory), landing, pasek postępu bake'u, dopracowanie Dark-Tech (`clip-path` 45°).

## 5. Ryzyka i ich mitygacja

| Ryzyko | Mitygacja |
|---|---|
| Cienkie elementy znikają / dają nie-manifold przy danym voxelu | Minimalne grubości w tabelach kroków (wielokrotności 0,4 mm) + walidator + test na całej puli kroków |
| Nawisy (głowa przed tułowiem, skrzydła, rogi baranie) | Reguły projektowe w katalogu klocków + analiza nawisów, a „bez podpór" traktujemy jako cel mierzalny |
| Kolor w 3MF różni się między slicerami | Spike na początku etapu 4, a nie na końcu |
| Rozjazd 2D ↔ 3D | Jeden rig, jedna tabela kroków, testy spójności N→2N |
| Eksplozja katalogu (wariant × 6 kroków × 2D+3D) | Generowanie menu i genomu ze schematu (już zrobione), każdy klocek tworzony raz w SDF |
