# Kontrakt elementu: 2D ↔ 3D ↔ druk

**Zasada nadrzędna:** każdy element widoczny w edytorze 2D musi (1) istnieć w 3D i (2) dobrze się drukować na Bambu Lab P1S (dysza 0,4 mm).
Nie dodajemy niczego do rysunku bez wpisu w katalogu. Pilnują tego testy (`tests/print.test.ts`).

## Jak dodać nowy element (lista kontrolna)
1. Dodaj wariant w `genome/schema.ts` (nigdy nie zmieniaj kolejności istniejących).
2. Narysuj go w `core/art/shapes.ts` jako **kontur w mm**. Ten kontur jest jednocześnie profilem do druku.
3. Dodaj wpis w `core/art/spec3d.ts` (`SPEC_3D`): kolor, grubość, położenie w Z, czy parzysty. `null` tylko dla czystego cieniowania lub lustra innego slotu. Test pokrycia 3D pada, gdy go brakuje.
3a. Dodaj slot do `SLOTS` oraz wpis w `core/print/catalog.ts` (`PARTS`): reprezentacja 3D, czy można go drukować osobno, uwagi.
   Jeśli to czysty efekt wizualny (cień, odblask), wpisz go do `RENDER_ONLY_SLOTS`. Nie może sugerować geometrii.
4. Jeśli element jest bryłą, dopisz jego slot do `PRINT_SOLID_SLOTS` i (jeśli da się go odłączyć) do grupy w `core/print/plan.ts`.
5. `npm test` (kontrakt + audyt losowych stworków) oraz `npm run audit -- 200 whole` / `modular`.

## Reguły druku (`core/print/rules.ts`)
| Reguła | Wartość |
|---|---|
| Najcieńszy wyrostek | 1,2 mm (ostrza kończą się płaskim czubkiem ≥ 1,4 mm) |
| Płytki (skrzydła, uszy), grubość Z | 1,6 mm |
| Nawis | ≤ 45° od pionu = druk bez podpór (przy dozwolonych podporach tylko informacja) |
| Most (dwustronnie podparty) | domyślnie 12 mm dla P1S, do wyboru 8 / 12 / 20 |
| Płaska podeszwa stopy | ≥ 60 mm² |
| Rowki (usta, brwi, wzory) | szer. ≥ 0,8 mm, głęb. ≤ 0,5 mm |
| Reliefy (oczy, nos) | wysokość ≥ 0,8 mm |
| Czop montażowy | 3×3×5 lub 5×5×8 mm, luz 0,2 mm na stronę, korzeń ≥ czop + 0,8 mm |

## Polityka: projektujemy bez podpór, użytkownik może wszystko zmienić, aplikacja mówi o skutkach
1. **Elementy w katalogu są projektowane tak, by w domyślnych rozmiarach drukowały się bez podpór.** Pilnuje tego `tests/print.test.ts`: uszy, rogi, skrzydła, grzywa/kolce i ogon nie dodają podpór w żadnym wariancie ani rozmiarze, a pysk w rozmiarach 1–3.
2. **Użytkownik może wybrać dowolny kształt i rozmiar**, także taki, który wymaga podpór (np. najdłuższy pysk, bardzo krótka szyja). Kształt nie jest wypaczany ani ograniczany pod druk. Brzuch jest okrągły, więc wymaga podpór u każdego stworka.
3. **Aplikacja mierzy zapotrzebowanie na podpory** (`supportArea`, mm² podpór w rzucie z boku) i po każdej zmianie porównuje stan przed i po. Jeśli zmiana je zwiększa albo łamie limit, który użytkownik chciał zachować, pokazuje komunikat: które części (z rozmiarem małe/średnie/duże), przyciski „Wydrukuj osobno: …" (z podpowiedzią, która część da największą poprawę), „Cofnij zmianę" i „Rozumiem". Przy dużym wzroście (> 400 mm²) komunikat zaleca rozbicie modelu. Zmiany zbiorcze (losuj, mutuj, wklejenie kodu) nie są ogłaszane, wynik widać w panelu.

## Podpory: kształt nigdy nie jest wypaczany
**Kształt figurki wynika z projektu, nie z ograniczeń druku.** Tułów jest okrągły, a podpory to ustawienie planu druku:
- **Dozwolone (domyślnie):** nawisy i mosty nie są błędem, slicer (Bambu Studio) doda podpory. Audyt tylko wskazuje, gdzie będą potrzebne (poziom niebieski „Z podporami").
- **Unikaj:** każdy nawis ponad 45° i most dłuższy niż limit jest zgłaszany jako uwaga lub błąd, a panel podpowiada „Wydrukuj osobno".
Niezależnie od podpór obowiązują twarde limity fizyczne: minimalna grubość wyrostków, brak elementów „wiszących w powietrzu", mieszczenie się na stole i czop o wystarczającym przekroju.

## Dwa sposoby druku (plan druku, poza DNA)
Morphotyp zawiera tylko fenotyp. **Sposób druku to osobny wybór użytkownika** (`PrintPlan`, zapisywany lokalnie):
- **Całość:** jedna bryła, wszystko zrośnięte. Audyt sprawdza nawisy i mosty całej sylwetki.
- **Moduły:** każda grupa (głowa z szyją, uszy, rogi, grzywa/kolce, skrzydła, ogon, nogi) osobno z czopem. Grupy zbyt drobne na czop zostają przy korpusie (`fitPlan`).
- **Własny:** dowolna kombinacja przełączników „Razem/Osobno" przy każdej grupie.
- **Wąsy są zawsze osobną płaską częścią** (z płytką-korzeniem), bo wystawałyby poziomo.

Części „flat" drukują się leżąc na boku, więc w 3D dostają płaski tył (to wymóg dla silnika bake). Części „upright" (głowa, nogi) są analizowane stojąc, po przesunięciu najniższego punktu na stół.

## Co sprawdza audyt (`core/print/analyze.ts`)
Rasteryzacja sylwetki z boku (komórka 0,3 mm), warstwa po warstwie od stołu: nawis, most, element „wiszący w powietrzu", zbyt cienki fragment, czop, podeszwa, mieszczenie się na stole.
Poziom: zielony (OK), żółty (z uwagami), czerwony (nie wydrukuje się tak, jak zaplanowano). Na rysunku 2D pojawiają się znaczniki w miejscach problemów, a panel „Kontrola druku" podaje akcję (np. „Wydrukuj osobno").

## Znane ograniczenia (uczciwie)
- Audyt patrzy na **sylwetkę z boku**. Okrągłe przekroje w osi Z tylko poprawiają sytuację, ale audyt ich nie modeluje. Pełna weryfikacja bryły nastąpi w silniku bake (Etap 3).
- Czopy i gniazda są na razie *planowane* (rozmiar i możliwość zamocowania), a ich geometria powstanie w silniku bake.
- Pole `coat.texture` (futro/łuski/pancerz) i `legs.count` nie są jeszcze rysowane, więc w UI są wyłączone.
- Wartości w `core/rig/dimensions.ts` i `core/print/rules.ts` to wartości wyjściowe do strojenia na prawdziwych wydrukach z P1S.

## Szczelność bryły (bez dziur i szpar)

- Każdy bake musi być wodoszczelny (0 krawędzi nieparzystych) – sprawdza `validateMesh`.
- Szpary w obrysach 2D (SLIT) są wykrywane w raporcie jako `info` i zamykane przy bake (SLIT_CLOSE_MM 0.5, GAP_MM 1.2).
- Otwory przelotowe (genus > 0) są zamykane trójwymiarowo (`close.ts`, CLOSE_HOLES_MM 2.0), o ile to poprawia wynik; liczba zamkniętych trafia do `BakedPiece.holesClosed`.
- Audyt (300 losowych stworków, szkic): tryb całość – 0 nieszczelnych, 1 korpus z dodatkową powłoką, 6 korpusów z dużym oknem (≥ ~4 mm, głównie duże skrzydła + ogon/kolce); tryb modułowy – 0 nieszczelnych, 0 dodatkowych powłok, 0 okien.
- Skrypt: `scripts/solid-audit.ts`.
