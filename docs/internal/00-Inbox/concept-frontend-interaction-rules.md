# Konzept: Verbindliche Frontend-Interaktionsregeln
Stand 2026-11-02, mit SE abgestimmt (OK, Ergänzungen eingearbeitet)

**Ziel:** Jede ACP-Oberfläche fühlt sich sofort an (wie Linear). Die Regeln gelten verbindlich für neuen Code und werden in CI erzwungen. Bestehender Code wird später modulweise migriert.

## Regeln
- **R1 Optimistisch:** Kann der Client das Ergebnis selbst berechnen (Status, Feldänderung, Zuweisen/Entfernen, Reihenfolge), ist ein optimistisches Update über `lib/optimistic-mutation.ts` Pflicht.
  - **Grenzfälle:** optimistisch nur, wenn der Client alle Daten zur Vorhersage hat und eine Ablehnung des Servers selten ist (fachlicher Konflikt, keine Validierung, die der Client schon prüfen kann). Prüfungen, die auf Cache-Daten laufen (z. B. Pflichtfeld), zuerst im Client. Umplanen mit Konfliktprüfung gegen geteilte Ressourcen (Bühnen, Mechaniker, Termine) und alles Umkämpfte (Bestand, Reservierungen, Nummernkreise) bleibt serverbestätigt. Jede neue Grauzonen-Mutation wird einmal entschieden und mit Begründung in der Ausnahmeliste festgehalten.
  - **Anlegen:** temporäre Client-ID, die bei Erfolg ersetzt wird; Idempotenzschlüssel, damit ein Retry keine Duplikate erzeugt.
  - **Realtime-Echo:** Das WS-Ereignis der eigenen Mutation darf nicht flackern; Abgleich über die Version, ältere Ereignisse als der Cache werden ignoriert.
  - **Rollback:** alten Wert an Ort und Stelle wiederherstellen, betroffene Zeile/Feld markieren bis zur nächsten Berührung, Toast mit Grund, Datensatzname und „Erneut versuchen“. Bei 409 den aktuellen Serverwert zeigen. Netzwerkfehler: Rollback, keine Offline-Warteschlange.
  - **Ausnahmen (serverbestätigt, Ladezustand nur im Button, nie Seiten-Spinner):** Fiskal/Buchung/Zahlung; serverseitig erzeugte Werte (Nummern, Preis/Steuer, Bestand bei Nebenläufigkeit); Berechtigungsänderungen (ADR-0034, explizites Speichern); Versand an Kunden; Importe.
- **R2 Laden:** Keine Seiten- oder Listen-Spinner. Skeleton nur beim ersten Laden; bei Filter, Refetch oder Seitenwechsel bleiben die alten Daten stehen; als Indikator dient eine gemeinsame Komponente (z. B. 2-px-Balken oben), keine Eigenbauten.
- **R3 Undo statt Rückfrage:** Nur wenn serverseitig wirklich umkehrbar. Standard ist die Gegen-Mutation mit Versionsprüfung (sofort für andere sichtbar, nichts geht beim Schließen verloren); hat sich der Datensatz inzwischen geändert, scheitert Undo mit Hinweis. Verzögerter Commit (~6 s) nur ohne saubere Gegen-Mutation und mit Flush bei `pagehide`/`visibilitychange`. Löschen = Soft-Delete + Wiederherstellen. Toast mit „Rückgängig“ (~6 s); Cmd/Ctrl+Z macht die letzte Aktion rückgängig. Löschen, fiskalische Aktionen und externe Seiteneffekte behalten die Bestätigung.
- **R4 Vorladen:** Nur bei Absicht (Hover/Fokus ca. 100 ms oder pointerdown), nie beim Rendern; nur was die Rolle sehen darf; mit `staleTime`.
- **R5 Tastatur:** Häufige Registry-Aktionen haben einen pro Scope eindeutigen `shortcutKey`; Listen unterstützen j/k/x. Kürzel sind in Eingabefeldern aus und kollidieren nicht mit Browser- oder Screenreader-Kürzeln. Ein „?“-Spickzettel listet alle. Mobil gibt es dieselben Aktionen über Long-Press bzw. das ⋯-Bottom-Sheet (AUT-783).
- **R6 Bewegung:** Übergänge standardmäßig 150 ms, Sheets/Dialoge 200 ms; `prefers-reduced-motion` wird respektiert.
- **Toasts allgemein:** `aria-live="polite"`; Fehler-Toasts bleiben bis zum Schließen.
- **R7 Listen:** Neue Listen nutzen den Infinite-/virtualisierten Modus nach ADR-0035, sobald er verfügbar ist.

## Durchsetzung
- **Einzige Quelle für Coding-Agents:** Abschnitt „Frontend interaction rules“ in `agents.md`, keine Kopie in `.cursor/rules` oder CLAUDE.md. Dazu ein Punkt in der PR-Checkliste und in der Definition of Done.
- **Wächter in CI**, jeweils mit eingechecktem Baseline der heutigen Verstöße, der nur schrumpfen darf:
  - ESLint-Regel: jede Mutation (`useMutation`, generierte Mutation-Hooks und eigene Wrapper) nutzt den Optimistic-Helper oder steht mit Begründungskommentar auf der Ausnahmeliste.
  - Jede DataTable-Liste verdrahtet `onRowPrefetch`.
  - `shortcutKey` eindeutig pro Scope (Registry-Parity-Test).
  - Lint gegen Dauern über 200 ms: Tailwind `duration-*`, CSS und framer-motion/JS.
  - Je Wächter zwei Tests: neuer Verstoß lässt CI scheitern; nach Migration entfernter Baseline-Eintrag lässt CI bestehen.
- QA behandelt Verstöße als Bug (wie „Kompakte Texte“).

## Abgrenzung
- Keine lokale Sync-Engine.
- Mobile und Mechaniker-Oberfläche: Tastaturregeln gelten nur für Desktop.
- Migration bestehender Module (Aufträge, Rechnungen, Fahrzeuge, Lager) folgt als eigene Tickets nach dem Merge (Linear-Projekt „Frontend: Linear feeling“, AUT-875 bis AUT-893).
