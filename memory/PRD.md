# B-ZONE 2.0 — PRD & Build Log

## Original Problem Statement
Mobile app (React Native/Expo + FastAPI/MongoDB REST) for managing facade/construction work. Etap 1 of 5. Build exactly Etap 1 scope but model the full data schema now so later stages don't rework it. Hard rules: single source of truth, ZERO mock data (aesthetic empty states only), no test-mode in build, every UI element clickable, full CRUD (archive for financial/evidentiary records), visual save confirmation + weak-network retry, PL/EN i18n, dark premium theme (#121212 + #F97316), audit log, push notifications, weather stamp on reports, photo GPS/timestamp metadata, multitenancy-ready (company_id everywhere), assistant-ready REST endpoints (one action = one endpoint).

## Architecture
- **Backend**: FastAPI (`/app/backend/server.py`), MongoDB (motor). String-uuid `id` fields, `_id` never exposed, `company_id` on every doc. JWT auth (PyJWT + bcrypt). Seeded admin on startup. Open-Meteo weather. emergentintegrations Whisper STT. Emergent push relay. Files stored server-side under `/uploads`, served via `/api/files/{id}/content`.
- **Frontend**: Expo Router file-based routing. Contexts: Auth, Projects, i18n (PL/EN), Toast. Design tokens in `src/theme/tokens.ts`. react-native-keyboard-controller for forms. Role-adaptive bottom tabs.

## Roles (5)
admin, foreman (brygadzista), subcontractor (podwykonawca), worker (pracownik), contractor (kontrahent/client). Registration → pending → admin approval assigns role + hourly rate.

## Core Requirements (static)
- Full CRUD everywhere with confirm-delete/archive modals
- Work-hour accrual engine (auto entries on working days, skip weekend unless soboty_auto; leaves/rotations tables ready but empty in Etap 1)
- Reports: voice→transcript into description, photos w/ timestamp+GPS, extra hours, weather stamp, approve/reject (reason mandatory)
- Issues with status history + decision reason
- Delivery notices with PDF/image attachment (contractor creates, foreman/admin decide)
- Audit log, notification center + push, PL/EN full i18n

## Implemented (2026-08-04) — Etap 1 COMPLETE
- Auth: register/login/reset, admin approval, JWT, role guards, seeded admin (admin@bzone.app / Admin12345!)
- Admin: dashboard metrics, Projects CRUD + archive + members, User management (approve/role/rate/edit/delete), Audit log, Archive (search)
- Foreman: day panel (crew on site), team hours (date strip, corrections, approve day/week), report approve/reject, issue status decisions, deliveries decisions
- Worker/Subcontractor: Today hours, new report (voice+photos+extra hours), report history, my hours, issues
- Contractor: project card (read-only), report archive, delivery notices with attachments
- Cross-cutting: notifications + unread badge, weather stamp (Open-Meteo), photo GPS/timestamp viewer, i18n PL/EN toggle, dark premium UI, empty/loading/error states, network retry, brand logo placeholder
- Verified: 40/40 backend pytest passing; frontend flows verified by testing agent

## Backlog / Next Stages (P-priorities)
- **P0 (Etap 2)**: Models/Views(zrzuty), elements (codes, sell price, geometry), price lists, financial engine, settlements/PDF (team & client), finances on dashboards
- **P1 (Etap 3-4)**: Accommodations + residents, costs, Gantt/phases, admin schedule (leaves + rotations wired to hour engine), materials, broadcasts
- **P2 (Etap 5)**: Reasoning/voice AI assistant calling the same REST endpoints + deep-link navigation
- **Tech debt**: migrate deprecated RN Web `shadow*`/`pointerEvents` style props (web-only warnings)

## Implemented (2026-08-09) — Etap 2A COMPLETE (Modele/Zrzuty)
- Backend: element_types (słownik, admin-only mutacje), folders→views→elements (admin+foreman CRUD), statusy do_wykonania/zgloszony_gotowy/odebrany, element_history z report_id, odbiory multi (receive/unreceive z powodem + 409 gdy ujęte w rozliczeniu), pending-receipt, modele_summary (postęp = odebrane/wszystkie). Pola projektu: tryb_rozliczenia (akordowy/godzinowy/mieszany) + stawka_sprzedazy_godz. ujete_w_rozliczeniu_id i geometria_json tylko utworzone, bez logiki.
- Frontend: ekrany models/[projectId], folder/[id] (upload zrzutu), view/[id] (canvas zoom/pan, tryb edycji + seria, panel odbioru multi), element/[id] (oś czasu), receipts/[projectId], element-types. Integracje: kafel Modele + Odbiory na karcie projektu, ElementPicker w report-new (2 tryby: lista + znaczniki na widoku), pola billing w project-form (stawka sprzedaży wymagana dla godz/mieszany), link "Słownik typów" w Więcej (admin-only).
- BEZPIECZEŃSTWO: strip_project_financials po stronie backendu — kontrahent NIE widzi stawka_sprzedazy_godz/bryg_widzi_stawki/termin_platnosci_*/vat_tryb (potwierdzone surową odpowiedzią API). Wszystkie tabele mają company_id.
- Weryfikacja: backend 33/33 test_etap2a_models.py + 70/70 regresja; frontend flow zielony (iteration_6.json). Cache Metro wyczyszczony przed zakończeniem.

## Runda 1 (2026-08-11) — naprawy przed wejściem ekipy (zakres zamknięty)
- 1.1 Raport: pogoda ograniczona timeoutem (asyncio.wait_for 6s, None gdy błąd) — POST /reports nigdy się nie zawiesza; walidacja frontendu z konkretnymi komunikatami; kompresja zdjęć (expo-image-manipulator 1920px/q0.6) + timeout/retry w uploadFile + komunikaty 413/sieć.
- 1.2 Unikalność kodów: walidacja create+edit (409), partialny unikalny indeks uniq_element_kod, /validate-codes, /duplicates + ekran /fix-duplicates + banner na models; tryb serii pomija zajęte kody.
- 2.1 Zgłoszenia: dodawanie dla worker/subcontractor/foreman/admin (FAB + pusty stan), backend 403 dla contractor.
- 2.2 report/[id]: zgłoszone elementy (klikalne), godziny ekstra (przyczyna/opis/element), klient, Zatwierdź/Odrzuć dla managera, pusty stempel pogody.
- 3.1 Wyczyszczono WSZYSTKIE dane testowe (0 projektów); zostawiono admina + 3 realne konta (nazwy wyczyszczone). element_types zresetowane do 5 domyślnych.
- 3.2 Hasło admina rotowane (silne, must_change_password=True), endpoint /auth/change-password + ekran /change-password + wymuszenie przy pierwszym logowaniu.
- 3.4 Usunięto martwy kafel „Harmonogram wkrótce". 3.5/3.6 StatusBadge i18n (koniec „Rozwiązane/Resolved"). 3.7 project-form: pole Termin + klient.
- 4. Schemat: elements.geometria_typ='punkt' + geometria_json=null (create + migracja).
- Weryfikacja: 114/114 backend (11 runda1 + 70 regresja + 33 Etap2A). Cache Metro wyczyszczony.

## Runda 1.1 (2026-08-12) — poprawki (część 1)
ZROBIONE+zweryfikowane backend: A1 (hasło min 14 w JEDNYM miejscu PASSWORD_MIN, reset przez admina, stary hash unieważniany), E1 (pełna edycja usera + unikalność e-mail 409), E3 (blokada usunięcia siebie/ostatniego admina, delete=archiwizacja), E4 (brak €/h dla admin/kontrahent), G6 (link element→raport), G7 („Wybrano X elementów"), G8 (normalizacja kodu: białe znaki+wielkość liter, indeks kod_norm+backfill), B1 (eksport /export: CSV per tabela + manifest schema_version + stabilne ID/relacje, bez hashy haseł; /export/last), C1 (manifest OK → nie brak uprawnień; naprawiono UX: nagranie zachowane przy błędzie, konkretny błąd, retry, timeout 90s — wymaga builda do walidacji), G1 (brak karty pogody gdy brak danych), D2 zawężone (Zaznacz/Odznacz wszystkie + 48dp), C2 częściowo (mic w opisie godzin ekstra).
DO ZROBIENIA (następna tura): D1 (tabela dostępu ról + brakujące ekrany brygadzisty/pracownika), F1 (wspólna powłoka Screen na ekranach z polami/akcją/tabami + nakładanie „Odbierz/Odbiory"), G2 (miniatura zdjęcia od razu), G4 (tygodniowe sumy godzin dla admina), G3 (audyt WSZYSTKICH komunikatów błędów), C2 pełne (mic we wszystkich polach), B1 przycisk eksportu w UI.
UWAGA G5: w tym środowisku preview i prod współdzielą bazę bzone_database — dlatego dane testowe trafiały na produkcję. Zamknięcie ścieżki: testy backendu robione bez trwałych danych (throwaway TEST_ + pełny cleanup + przywrócenie hasha admina); NIE uruchamiam testing_agent na współdzielonej bazie. Dwa rekordy (UI_Test_c5fb8, test_ui_*) usuwa użytkownik sam w aplikacji.

## Runda 1.1-hotfix (2026-08-12) — incydent: utrata konta admina + twarde kasowanie
PRZYCZYNA: self-service `DELETE /api/auth/me` (App Store) robił TWARDE kasowanie bez blokad → admin skasował własne konto. E3 chroniło tylko `/users/{id}`.
NAPRAWY (zweryfikowane testerem 58/58): (1) `DELETE /auth/me` → blokada ostatniego admina + archiwizacja; (2) seed odtwarza/reaktywuje `admin@bzone.app` przy starcie (chirurgicznie, tylko to konto); (3) 4 endpointy dowodowe (extra-hours, reports, issues, elements) → archiwizacja zamiast delete_one + kontrola rola/właściciel; elementy jednolicie archiwizowane niezależnie od statusu; (4) `PUT /reports` → kontrola autor/manager; (5) listy wykluczają `zarchiwizowany`. W server.py NIE ma już delete_one na daily_reports/extra_hours/issues/elements (tylko project_members = join).
SEED_ADMIN_PASSWORD ustawione na Chelsea1234567890! (wymuszona zmiana przy 1. logowaniu).
P3: stawka_godz_eur (koszt) i marża NIEwidoczne dla foreman/subcontractor na poziomie endpointów. P4: worker==subcontractor identyczne ekrany (różnica tylko w modelu danych).
ŚRODOWISKO: preview (localhost:27017/bzone_database) i produkcja to RÓŻNE bazy; produkcja niedostępna z preview. Do Rundy 1.2: regresje 1.0.6 (Odbiory crash, czarny rysunek) + F1/D1/G4/G2/G3/C2/przycisk eksportu/D2 select-all/martwy „Zresetuj hasło".

## Runda 1.2 (2026-08-15) — cel 1.0.8 (część zrobiona + zweryfikowana testerem)
ZROBIONE (6/6 PASS iter11): A2 crash „Odbiory" (spójna para allSelected+toggleAll); B1 jedna reguła PASSWORD_MIN=14 w 4 ścieżkach (register/change/admin-reset/token-reset); B2 reset tokenem wymusza must_change_password; C1 indeks unikalności kodów obejmuje ACTIVE_ELEMENT_STATUSES (wszystkie poza zarchiwizowany) + drop starego; C2 przycisk „Eksport danych" w Więcej (admin); E1 brygadzista ma akcję „Nowy raport" na Home. Config: app.json version 1.0.8, versionCode 124 (>123), android.allowBackup=false. Endpoint /admin/health (read-only) do weryfikacji indeksu/kolizji/liczników na produkcji po redeployu.
OPIS-ONLY (czeka na zgodę): A1 trwałe przechowywanie plików → Emergent Managed Object Storage (nie implementuję bez zgody właściciela).
ODŁOŻONE (dedykowana tura, za duże/ryzykowne na resztę budżetu): D — wspólna powłoka Screen na WSZYSTKIE ekrany/modale z polami/akcją/tabami + tabela zastosowano/pominięto; regresja „czarny rysunek elewacji" w widoku zrzutu (Image nie ładuje tła).
ŚRODOWISKO: preview=localhost/bzone_database; produkcja=osobna baza (niedostępna z preview). Do zmian na produkcji wymagany redeploy.

## Notes / Not-yet-live
- Push notifications: structure implemented (register-push + server-side send_push on events). Requires `google-services.json` (Android) + deploy → build to actually deliver; does NOT work in Expo Go.
- App logo: bison-in-hard-hat placeholder ("BZ"/hammer) — swap in real PNG when provided (icon, splash, login).

## Runda 1.3 (v1.0.9, versionCode 125) — DONE 2026-06
- A1: Emergent Object Storage dla plików (upload/odczyt, fallback legacy, sweep sierot -> status "utracony" + 410, UI fallback "Plik utracony" zamiast czarnego rysunku)
- A2: PUT /projects partial update (exclude_unset)
- B3: hasło generowane backendem (secrets, 16 zn.) + modal z Kopiuj; B5: lockout 5 prób/15 min (423) + rejestracja 3/h/IP (429); B6: "Zmień hasło" w profilu
- C2b: eksport ZIP natywnie (expo-file-system/legacy + expo-sharing); C3: pogoda ukryta gdy brak temp (backend+frontend); C4: detailToMessage dla 422
- D: adjustResize, tab bar + insets.bottom, KeyboardAvoidingView w modalach (users, dodaj-element)
- E1b: role guards (POST /reports, /extra-hours bez contractor; łaty: DELETE /deliveries owner/manager, /register-push auth); E3: natychmiastowa miniatura + "Wysyłanie…"; E4: catch-e.message
- E2 ODŁOŻONE (decyzja właściciela — Etap 3 zmieni model godzin)
- G1: blockedPermissions; G2: CORS credentials off; G3: PIN switch usunięty
- H1: nudge usunięty; H2: kafelek harmonogram usunięty; H3: Dostawy=liczba; H4: st_zatwierdzone + dedup; H5: i18n literały; H6: unreceive UI + edycja raportu (przed zatwierdzeniem); H7: "Pokaż na zrzucie" + ?focus= (zoom/highlight/detail) + celownik w odbiorach
- /api/admin/health: + llm_key_configured, storage_configured, files_total/in_storage/utracone
- Testy: iter12 (backend 10/10 po poprawce B5), iter13 (frontend 6/6)
- Sprawozdanie: /app/memory/SPRAWOZDANIE-RUNDA-1.3.md
- UWAGA TECHNICZNA dla agentów: NIE wykonywać wielu search_replace RÓWNOLEGLE na TYM SAMYM pliku — edycje się gubią (3 przypadki w tej sesji).

## Runda 1.3 — poprawka D po teście na urządzeniu (S24 FE, APK vc129) — 2026-06
- editBar w view/[id].tsx objęty KeyboardStickyView (offset opened=insets.bottom) — pasek Seria/prefiks/numer jedzie nad klawiaturą
- Modale z polami: KAV behavior="padding" na OBU platformach (wcześniej Android=undefined=no-op) + statusBarTranslucent/navigationBarTranslucent: modal "Dodaj element" (view/[id]), modal edycji użytkownika (users), ConfirmModal (pole "powód")
- Kontekst techniczny: edgeToEdgeEnabled + targetSdk 36 ⇒ Android ignoruje adjustResize; obsługa klawiatury musi być komponentowa (keyboard-controller 1.18.5, KeyboardProvider już w root)
- app.json versionCode → 130 (binarka właściciela miała 129; EAS auto-inkrementuje — app.json to dolna granica)
- Formularze (report/issue/delivery/project) już wcześniej na KeyboardStickyView — bez zmian

## Runda 2 (v1.2.0, versionCode 132) — DONE 2026-06 — „Prostokąty i edytor pod mysz"
- Model: geometria_typ punkt|prostokat, geometria_json.punkty (4 narożniki, rel 0..1), pozycja = środek (przeliczany serwerowo). ZAKAZY: zero liczenia powierzchni z geometrii, zero SVG/Skii, zero wielokątów.
- Backend (wszystko admin-only): POST /views/{vid}/elements (już nie foreman!), POST .../elements/batch (walidacja serii PRZED insertem, 1 wpis audytu), PUT /elements/batch-geometry, POST /elements/batch-archive, POST /elements/batch-restore; PUT /elements/{eid}: pola geometrii tylko admin (foreman nadal kod/typ/opis).
- Mobile view/[id].tsx: edytor CAŁKOWICIE usunięty z telefonu (view+receive only); prostokąty = View (stała ramka 2/scale, wypełnienie 30%, próg etykiet, hitSlop 48dp, React.memo).
- Web+admin: GeometryEditor (src/components/web/GeometryEditor.tsx) — punkt/prostokąt 2 kliki+Shift+Esc, zaznaczanie klik/Ctrl/marquee, drag, uchwyty, Delete→archiwum, undo/redo 30 (siatka=1 krok), Ctrl+C/V, powielanie siatka/linia z podglądem i kodami serii (kolizje przed zapisem), 6 wyrównań+2 rozłożenia+ujednolicenie+2 lustra, siatka przyciągania % szer., zoom do kursora/pan/fit/100%/współrzędne.
- Naprawione po drodze: remount toolbara (komponenty w renderze), stale closures (actionsRef), natywny img-drag porywający mysz (preventDefault + pointerEvents none).
- Testy: iter14 (backend 9/9, frontend PASS) + pomiary px 4 przepływów myszy. Dane testowe: projekt TEST_R2_EDITOR (2 widoki, PERF 200).
- Sprawozdanie: /app/memory/SPRAWOZDANIE-RUNDA-2.md

## Runda 2.1 (patch, app.json vc134) — DONE 2026-06 — edytor na tablecie + responsywny toolbar
- BLOK 1: GeometryEditor dostępny gdy admin && (web z min. bokiem okna >=600dp LUB natywny tablet). Hook src/hooks/use-is-tablet.ts: expo-device getDeviceTypeAsync (TABLET), fallback shortestSide>=600dp. Telefon/nie-admin: bez zmian (niewidoczny).
- Natywna warstwa dotyku w edytorze: wspólny rdzeń pointerDown/Move/Up (refaktor z DOM handlerów, zero zmian logiki), 1 palec = rysowanie/zaznaczanie/przesuwanie/uchwyty, 2 palce = pinch-zoom+pan; tolerancje trafień 24px na dotyku (>=48dp); DOM effect za guardem Platform.OS==="web".
- BLOK 2: toolbar pogrupowany separatorami (tryby|historia|wyrównanie|rozmieszczenie/lustro|edycja|siatka|widok), compact (same ikony) przy szer. <1500px + poziomy scroll jako zabezpieczenie + przyciski Przybliż/Oddal (zoom_in/zoom_out w translations). Przy 1366px cały pasek widoczny bez scrolla.
- Testy (preview): regresja web admin (2-klik, persist po refresh, ghost preview siatki, Ctrl+Z=1 krok), telefon-admin bez edytora, foreman bez edytora, toolbar 1366/1194/820.
- UWAGA: natywny dotyk na fizycznym tablecie do potwierdzenia przez właściciela po buildzie (preview przeglądarkowe nie emuluje Platform.OS==='android').
