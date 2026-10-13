# Architektura rdzenia (Etap 0)

```
src/core
├─ genome/   schema.ts  deklaratywny opis 13 bloków (bity, warianty)
│            codec.ts   serialize / parse / CRC-4 / N→2N / losowanie
├─ rig/      dimensions.ts  tabele krok → mm (PLACEHOLDERY do strojenia)
│            rig.ts         solveRig: FK + kotwica Y=0 + walidacja
├─ radial/   menu.ts    drzewo z schematu, layout pierścienia, automat stanów
└─ store.ts  genom + historia undo/redo, pochodne: kod, rig
```

## Morphotyp (29 znaków)

`MPH` + 13 bajtów. **Jeden blok = jeden bajt**, pola pakowane od najstarszego bitu, wolne bity zarezerwowane (0).

| # | Blok | Pola (bity) |
|---|---|---|
| 1 B | Tułów | kształt(2) długość-krok(3) pękatość-krok(3) |
| 2 L | Nogi | liczba(1) stopa(2) wysokość-krok(3) |
| 3 H | Głowa/szyja | czaszka(3) fasada szyi(2) długość szyi-krok(3) |
| 4 S | Pysk | typ(2) wysunięcie-krok(3) |
| 5 E | Uszy | typ(3) skala-krok(3) |
| 6 O | Rogi | typ(3) rozpiętość-krok(3) |
| 7 W | Skrzydła | typ(2) wielkość-krok(3) |
| 8 T | Ogon | typ(2) długość-krok(3) |
| 9 C | Czub/grzywa | typ(3) skala-krok(3) |
| 10 D | Detale twarzy | oczy(2) zęby(2) wąsy(2) mina(2) |
| 11 K | Pokrycie | faktura(3) wzór(3) |
| 12 X | Dodatki | typ(4) |
| 13 P | Paleta | **[CRC-4][paleta:4]** |

Decyzje wynikające z Twojej specyfikacji:

- **Suma kontrolna to górny półbajt bloku P** (paleta potrzebuje tylko 4 bitów z 8). Dzięki temu format nadal ma równo 13 bajtów i 29 znaków. CRC-4/ITU wykrywa każdy błąd pojedynczej cyfry HEX (test sprawdza wszystkie 25 pozycji × 15 podmian).
- **Suma kontrolna jest „miękka":** `parse` zwraca `checksumOk`. Przykładowy kod `MPH0204030502010406031A080107` ma górny półbajt 0, więc się wczyta, ale UI powinno pokazać ostrzeżenie. Kody generowane przez aplikację zawsze mają poprawną sumę.
- **Postać kanoniczna:** typ „Brak" zeruje pozostałe pola bloku, więc jeden fenotyp = jeden kod.
- **Brak bajtu wersji** (13 bloków wyczerpuje bajty). Kompatybilność zapewnia reguła: **nigdy nie zmieniać kolejności ani szerokości pól, tylko dopisywać warianty** do wolnych wartości. Jeśli wersjonowanie okaże się potrzebne, można poświęcić wolne bity w bloku L (6 z 8 używanych) lub D.
- Parser najpierw znajduje `MPH`, dopiero potem wycina znaki spoza HEX. Dzięki temu litery A–F z otaczającego tekstu nie wpadają do kodu. Wersja segmentowa (`MPH-02-04-…`) działa.
- Wartości spoza zakresu są przycinane z ostrzeżeniem (`warnings`), a parser nigdy nie rzuca wyjątku.

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
