# Kontrakt elementu: 2D ↔ 3D ↔ druk

**Zasada nadrzędna:** każdy element widoczny w edytorze 2D musi (1) istnieć w 3D i (2) dobrze się drukować na Bambu Lab P1S (dysza 0,4 mm).
Nie dodajemy niczego do rysunku bez wpisu w katalogu. Pilnują tego testy (`tests/print.test.ts`).

## Jak dodać nowy element (lista kontrolna)
1. Dodaj wariant w `genome/schema.ts` (nigdy nie zmieniaj kolejności istniejących).
2. Narysuj go w `core/art/shapes.ts` jako **kontur w mm**. Ten kontur jest jednocześnie profilem do druku.
3. Dodaj slot do `SLOTS` oraz wpis w `core/print/catalog.ts` (`PARTS`): reprezentacja 3D, czy można go drukować osobno, uwagi.
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
