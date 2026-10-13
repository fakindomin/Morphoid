# Architektura rdzenia (Etap 0)

```
src/core
├─ genome/   schema.ts  bloki i pola stwora, tabela genów DNA v2
│            codec.ts   serialize / parse / CRC-8 / N→2N / losowanie
│            v1.ts      czytnik starych kodów MPH + 26 hex
│            name.ts    imię stwora z kodu, nazwy plików
├─ catalog/  registry.ts  numery wariantów + kontrola registry.lock.json
├─ rig/      dimensions.ts  tabele krok → mm (PLACEHOLDERY do strojenia)
│            rig.ts         solveRig: FK + kotwica Y=0 + walidacja
├─ radial/   menu.ts    drzewo z schematu, layout pierścienia, automat stanów
└─ store.ts  genom + historia undo/redo, pochodne: kod, rig
```

## DNA v2 (geny)

Kod to lista genów rozdzielonych dwukropkami, zawsze w tej samej kolejności i zawsze wszystkie, więc każdy kod ma tę samą długość i dwa kody porównuje się znak po znaku:

```
MPH2:B01.33:L01.3:N01.3:H01:S02.3:E01.3:R00.0:W00.0:T01.3:U00:C00.0:O02:M01:Z00:V00:F01:D00:A00:G00:P00#CC
```

- Gen = litera części + **stały numer wariantu** (2 znaki hex) + cyfry rozmiaru 1–6 (tułów ma dwie: długość i pękatość; 0, gdy części nie ma).
- Numer wariantu to pozycja opcji w schemacie: pole z opcją „Brak” na początku (i paleta) liczy od 00, pozostałe od 01. Dlatego opcje **tylko się dopisuje**. Wariantu się nie usuwa, tylko oznacza `retired` (znika z menu i losowania, stare kody dalej go rysują).
- Litery: B tułów, L nogi, N szyja, H czaszka, S pysk, E uszy, R rogi, W skrzydła, T ogon, U końcówka ogona, C grzywa/czub/kolce, O oczy, M mina, Z zęby, V wąsy, F faktura, D deseń, A dodatek na ciało, G dodatek na głowę, P paleta. Nowa część = nowa litera na końcu; w starszych kodach brakujący gen ma wartość domyślną.
- `#CC` to CRC-8 (wielomian 0x07) z tekstu przed `#`. Suma jest „miękka”: `parse` zwraca `checksumOk`, a kod bez sumy też się wczyta.
- `parse(tekst, baza)` toleruje wielkość liter, spacje i tekst dookoła. Gen z nieznanym numerem trafia do `badGenes`, a ta część zachowuje wartość z `baza` (w studiu: obecny stwór), więc ręczna edycja zmienia tylko to, co nazywa.
- Stare kody `MPH` + 26 hex (format v1, 13 bajtów, CRC-4) czyta `genome/v1.ts` z zamrożonym układem bitów. Pole „liczba nóg” zostało usunięte.

### Rejestr wariantów

`core/catalog/registry.ts` wylicza z schematu wszystkie numery każdej litery. `registry.lock.json` zapisuje każdy wydany numer. Test `registry.test.ts` pada, gdy numer zniknie, zmieni znaczenie (klucz) albo ten sam wariant dostanie dwa numery. Po dodaniu wariantu: `npm run lock` i commit obu plików. Gdy dwie osoby dodadzą wariant naraz, git pokaże konflikt w pliku blokady.

### Imię stwora i pliki

`creatureName(kod)` losuje imię z sylab (ziarno = FNV-1a kodu), więc ten sam kod zawsze daje to samo imię. Własne imię użytkownika jest zapisywane lokalnie (`morphoid.names`), nie w DNA. Pliki: `Morphoid <Imię>.stl / .3mf / .zip`. Kod DNA jest w `Metadata/dna.txt` i w opisie 3MF oraz w `dna.txt` w ZIP. Nagłówek STL (80 bajtów, ASCII) ma imię, skrót kodu `#xxxxxx` i nazwę części.

- **Postać kanoniczna:** typ „Brak” zeruje pozostałe pola bloku, więc jeden fenotyp = jeden kod.

## Reguła N→2N

Pole `step` ma 6 wartości (2N). Klasa 2D (N=3) to `floor(step/2)`. Wybór klasy w 2D zachowuje obecny krok, jeśli leży już w tej klasie (idempotentnie), w przeciwnym razie przechodzi na pierwszy krok klasy. Dzięki temu zmiana suwaka 3D i wybór w 2D nigdy się nie „kłócą".

## Rig

- Węzły: `torso → {shoulderF, hipB → stopy×4, neckBase → head → {muzzle, hornRoot, earRoot}, crestRoot, wingRoot, tailBase → tailTip}`.
- `solveRig` liczy FK, a potem **przesuwa całość tak, by najniższy węzeł `contact` leżał na Y=0**. To uogólnia regułę podłoża: zadziała też, gdy przednie i tylne nogi dostaną różne długości.
- `validateRig` zwraca stabilne identyfikatory naruszeń: `GROUND_NOT_ANCHORED`, `BELOW_BED:<węzeł>`, `SOLE_TOO_SMALL`. Testy sprawdzają je wyczerpująco (1296 kombinacji nóg/pękatości/stóp/szyi/ogona) i na 3000 losowych genomach.
- Stopy mają obowiązkową płaską podeszwę (`FOOT_SOLE`, min. 60 mm²). Dotyczy to też „Pazurów", które w makiecie miały tylko punkty styku.
- Dwie nogi „przednia/tylna" w menu edytują ten sam parametr (jeden blok L), jak w makiecie. Rozdzielenie wymaga nowego pola w schemacie.

## Menu kołowe

Automat `reduceMenu(state, event) → { state, effects }`. Zdarzenia: `open`, `pick{id, angle}`, `back{angle}`, `close`. Efekty: `commit{ops}` i `revert`. Warstwa UI mapuje je na `store.applyOps` oraz `store.undo`.

- Wejście do podmenu: WSTECZ pojawia się pod kursorem i cofa o poziom.
- Wybór liścia: zatwierdza zmianę, pierścień pokazuje tylko WSTECZ pod kursorem, a jego kliknięcie **cofa wybór** (`revert`) i wraca na poziom liścia.
- Ujednolica to dwa różne zachowania z makiet (landing vs studio 2D).
