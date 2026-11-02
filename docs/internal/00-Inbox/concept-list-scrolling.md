---
title: "Konzept: Listen ohne Seiten"
date: "2026-11-02"
status: accepted
tags:
  - concept
  - platform
  - tables
---

# Konzept: Listen ohne Seiten (Infinite Scroll + Virtualisierung)

Stand 2026-11-02. Architekturentscheidung durch Dejan Dosenovic als [ADR-0035](../01-ADR/2026-11-02-cursor-based-infinite-lists.md) akzeptiert. Dieses Begleitkonzept beschreibt die Details und die noch ausstehende Pilot-Abnahme.

**Ziel:** Listen fühlen sich wie Linear an: kein Blättern, kein Leerflackern, flüssiges Scrollen. Keine lokale Sync-Engine; der Teilekatalog kann Millionen Zeilen enthalten.

**Ist:** Shared `DataTable` mit manueller serverseitiger Filterung, Sortierung und Offset-Paging. Standardgröße und Obergrenze sind endpunktspezifisch (häufig Standard 25 und maximal 100; Fahrzeuge maximal 50). Mehrere Listen zählen bei jedem Request vollständig. Einzelne Hooks verwenden bereits `keepPreviousData` oder `useInfiniteQuery`; diese Muster vor einer Erweiterung prüfen. Realtime-Ereignisse invalidieren derzeit aktive Queries mit automatischem Refetch.

## 1. Umfang und Konsistenz

- Der Pilot ersetzt Navigation und Rendering ausgewählter Listen. Geschäftsregeln, Rollen, Bestandsledger, Fiskalsperren und Statusübergänge bleiben bestehen.
- Die Liste ist eine **Live-Abfrage ohne Snapshot-Garantie**. Keyset verhindert die durch Offset-Verschiebungen verursachten Wiederholungen und Auslassungen bei unveränderten Sortierwerten. Neue Datensätze vor dem Cursor erscheinen erst beim Aktualisieren; geänderte Sortierwerte können Datensätze über die Cursorgrenze verschieben.
- Der Client führt geladene Zeilen nach stabiler Datensatz-ID zusammen. Das verhindert sichtbare Duplikate, garantiert aber keine vollständige Momentaufnahme. Vollständigkeit darf weder aus der Anzeige noch aus dem gedeckelten Zähler abgeleitet werden.
- Vorerst höchstens **2.000 geladene Zeilen pro Ergebnisliste**; danach stoppt das Nachladen mit „Filter verfeinern“. Das ist eine bewusste Produktgrenze, keine Begrenzung der serverseitigen Suche. Alle vorhandenen Suchfelder und Filter bleiben verfügbar. Eine beliebig lange, bidirektionale Liste ist nicht Teil des Piloten.

## 2. Backend: Cursor-Vertrag

- Gemeinsamer Keyset-Helper in `query-builder`, mit Prisma-Filtern statt Raw-SQL. Cursor-Modus ist je Endpunkt und Sortierung ausdrücklich freigeschaltet; kein stiller Wechsel zwischen Cursor und Offset innerhalb einer Abfrage.
- Cursor-Anfragen verwenden `limit` mit dem bisherigen Standard und der bisherigen Obergrenze des jeweiligen Endpunkts (mindestens 1, höchstens 100; Fahrzeuge höchstens 50). Bestehendes Clamping übergroßer Anfragen bleibt erhalten; `limit` bezeichnet im Folgenden die wirksame Seitengröße nach Validierung/Clamping. Die Antwort folgt `{ data, meta }`: `meta.nextCursor` ist ein opaker String oder `null`; `meta.hasNextPage` ist entsprechend wahr oder falsch. Der Server liest `limit + 1`, liefert höchstens `limit` Zeilen und bildet den nächsten Cursor aus der letzten **gelieferten** Zeile. Kein `total` und keine Seitenzahl erforderlich.
- Cursor enthält Version, Endpunkt, Sortfeld, Richtung, letzte Werte, einen Hash der normalisierten Such-/Filterparameter sowie eine Bindung an Tenant und autorisierten Standortkontext. Werte müssen mit dem Datenbanktyp verlustfrei vergleichbar sein. Der Server prüft Struktur, Typen, Größe und Bindungen; der Cursor erteilt niemals Berechtigungen.
- Tenant und Standortberechtigungen kommen bei **jeder** Anfrage aus dem authentifizierten Kontext. Tenant-Modelle werden mit `tenant_id` gefiltert; Standortmodelle zusätzlich mit aktivem `site_id` oder dem autorisierten Standort-Helper nach ADR-0022. Cursor-Bindung ersetzt diese Filter nicht. Scope-Wechsel verwirft Cursor, Zeilen, Auswahl und gespeicherte Scrollposition.
- Ein formal ungültiger, inkompatibler oder nicht mehr passender Cursor ergibt `400` mit einem eigenen dokumentierten Fehlercode. Nur dieser Cursorfehler bietet einen Neustart bei Seite eins; andere `400`, `401`, `403`, `404` oder ein fehlender aktiver Standort werden nach ihrem jeweiligen API-Vertrag behandelt. Keine automatische Neustartschleife.

### Sortierung und NULL-Werte

Pro Cursor-Sortierung genau ein freigegebenes Sortfeld plus eindeutige `id` als Tiebreaker, beide in derselben Richtung. Bei Sortierung ausschließlich nach `id` entfällt der zusätzliche Tiebreaker. Vergleiche und `ORDER BY` verwenden dieselben Datenbanktypen und dieselbe Kollation.

| Richtung | Cursorwert nicht NULL: nächste Zeilen | Cursorwert NULL: nächste Zeilen |
|---|---|---|
| ASC | `sort > x OR (sort = x AND id > y) OR sort IS NULL` | `sort IS NULL AND id > y` |
| DESC | `sort < x OR (sort = x AND id < y) OR sort IS NULL` | `sort IS NULL AND id < y` |

`NULLS LAST` gilt explizit in beiden Richtungen. Bei nicht-nullbaren Feldern entfällt der NULL-Zweig. Die Bedingung für die nächste Seite wird per **AND** mit Tenant-, Standort-, Such- und Fachfiltern verbunden, damit vorhandene Such-`OR`-Bedingungen erhalten bleiben.

- Sortier-Whitelist je Endpunkt. Die unterstützten Richtungen und die NULL-Reihenfolge müssen durch passende B-Tree-Indizes und repräsentative Query-Pläne belegt sein, typischerweise `(tenant_id, [site_id], sort_col, id)`. Ein normaler ASC-Index liefert rückwärts `DESC NULLS FIRST`; für nullable DESC-Sorts mit `NULLS LAST` ist ein dazu passender Index erforderlich.
- Suchfilter benötigen ebenfalls passende Zugriffswege. Ein Sortierindex allein garantiert keine schnelle kombinierte Suchabfrage. Der Pilot prüft verbreitete und selektive Filter sowie leere Treffer bei katalogtypischer Datenmenge.
- Relationsfelder (z. B. Kundenname), berechnete Werte (offener Saldo, Status-Reihenfolge) und Suchrelevanz behalten zunächst ihren bisherigen Offset-Pfad. Eine Denormalisierung oder eine Begrenzung der Relevanzsuche wird hier nicht beschlossen. Bestehende Sortierungen bleiben nutzbar; Cursor-fähige Sortierungen werden vor der View-Migration dokumentiert.

## 3. Gedeckelter Zähler

- Separater, paralleler Request beim Öffnen oder Wechsel des Such-/Filterkontexts, ohne Cursor und mit denselben Berechtigungs- und Fachfiltern. Sortierwechsel allein löst keine neue Zählung aus. Ein explizites Aktualisieren erneuert auch den Zähler.
- Nur IDs von höchstens 1.001 Treffern lesen und deren Anzahl bestimmen, z. B. mit Prisma `findMany`, `select: { id: true }` und `take: 1001`. Kein vollständiges `COUNT(*)` mit außen angehängtem `LIMIT`; das würde die Aggregationsarbeit nicht begrenzen. Die Abfrage zählt eindeutige Listen-Datensätze, keine vervielfachten Join-Zeilen.
- Ergebnis: `{ count: 0..1000, isCapped: false }` oder `{ count: 1000, isCapped: true }` für „1.000+“. Der Wert beschreibt den Zeitpunkt dieser separaten Abfrage, nicht einen gemeinsamen Snapshot mit den Zeilen. Eine begrenzte Treffermenge begrenzt nicht automatisch die Arbeit für seltene oder erfolglose Suchfilter; diese Fälle gehören in die Query-Plan-Prüfung.
- Zählerfehler blockieren keine Zeilen; Anzeige „Anzahl nicht verfügbar“ mit Wiederholung. Veraltete Zählerantworten nach Filter- oder Scope-Wechsel werden verworfen. Das Listenende folgt ausschließlich `nextCursor`, nicht dem Zähler.

## 4. Frontend und Aktualisierung

- `DataTable` erhält einen optionalen Infinite-Modus mit `useInfiniteQuery` und TanStack Virtual. Offset-Modus bleibt während der Migration verfügbar. Query-Key-Factories unterscheiden Modus, normalisierte Filter, Suche, Sortierung und Kontext; Cursor gehören zu `pageParams`, nicht in einen neuen Query-Key je Seite.
- Nachladen spätestens einen Viewport vor dem Ende, nur bei `hasNextPage` und ohne bereits laufenden Fetch. Initial bis zur gefüllten Ansicht nachladen, damit auch große Viewports ohne Scrollbalken funktionieren. Der 2.000-Zeilen-Stopp hat Vorrang und wird vom tatsächlichen Listenende unterschieden.
- Bei Änderung von Suche, Filter oder Sortierung werden Requests über das Query-Abortsignal abgebrochen, die bisherige Cursor-/Seitenkette verworfen, die Auswahl geleert, nach oben gescrollt und alte Antworten ignoriert. Die neue Abfrage startet immer frisch bei Seite eins, auch wenn für den gewählten Query-Key noch Seiten gecacht sind; die Unterdrückung automatischer Refetches verhindert diesen Neustart nicht. Alte Zeilen dürfen bis zur ersten neuen Antwort als erkennbar veraltete Vorschau stehen bleiben; währenddessen sind deren Navigation, Kontextmenüs, Cmd+K-Zeilenaktionen, Auswahl und Massenaktionen gesperrt. Ein Fehler der neuen Abfrage zeigt Wiederholung und schaltet die alten Zeilen nicht wieder als aktuelle Treffer frei. Nach einem leeren Ergebnis verschwinden sie vollständig.
- Tenant-/Standortwechsel und Berechtigungsänderungen verwenden weiterhin den zentralen Session-Reset: laufende Queries abbrechen, Cache und Vorschau leeren. Alte Kontextdaten dürfen dabei nicht als Platzhalter erscheinen.

### Realtime ohne vollständige Refetch-Kette

- Für migrierte Infinite-Listen werden **alle** Aktualisierungsauslöser berücksichtigt: Realtime-Invalidierung, eigene Mutationen, Window-Focus, Reconnect, erneutes Mounten einer gecachten Liste und periodische Refetches. Diese Listen dürfen dabei nicht automatisch sämtliche geladenen Seiten neu laden. Bestehende Detail-, Dashboard- und Offset-Queries behalten ihr Verhalten.
- Die betreffenden Listen werden als veraltet markiert, ohne sofortigen Refetch (`refetchType: 'none'` für diese Query-Keys); eine sichtbare Meldung bietet „Liste aktualisieren“. Die vorhandenen Invalidierungswege müssen dafür zwischen Infinite-Listen und anderen Queries unterscheiden. Automatischer Refetch bei Mount, Focus und Reconnect wird für diese Queries deaktiviert; veralteter Cache beim Mount und Focus/Reconnect zeigen stattdessen Aktualisierungsbedarf. Eine Liste ohne Cache lädt weiterhin ihre erste Seite. Ereignisse während der ersten Abfrage oder eines Nachladens gehen dabei nicht verloren.
- „Liste aktualisieren“ bricht laufendes Nachladen ab, verwirft Cursor und geladene Seiten, leert die Auswahl, scrollt nach oben und lädt genau Seite eins sowie den separaten Zähler neu. Die Aktion startet eine neue Query-Kette und refetcht nicht sämtliche zuvor geladenen Seiten. Währenddessen gelten die Vorschau-Regeln oben. Automatisches Nachladen zur Viewport-Füllung erfolgt erst nach dieser neuen ersten Seite.
- Trifft während des Aktualisierens ein weiteres Ereignis ein, bleibt die Meldung anschließend bestehen. Nachladefehler zeigen eine Retry-Zeile und lassen bereits geladene aktuelle Zeilen bedienbar; es gibt höchstens einen laufenden Fetch pro Infinite-Query.

### Navigation, Tastatur und Mobile

- Sticky Header. Suche, Filter und Sortierung bleiben URL-Zustand. Zurück aus einer Detailansicht stellt bei unverändertem Kontext und noch vorhandenem Listencache die Position über Datensatz-ID und Pixelabstand wieder her. Bei fehlendem Cache oder geändertem Ergebnis startet die Liste oben; sie lädt nicht dutzende Seiten nur zur Wiederherstellung nach. Alte `page`-Links starten im Infinite-Modus oben, erhalten aber Suche, Filter und Sortierung.
- Fokus und aktive Zeile werden über Datensatz-ID gehalten, nicht über DOM-Position. Pfeiltasten können über eine Rendergrenze hinweg scrollen und die Zielzeile nach deren Mount fokussieren. Eine fokussierte Zeile bleibt bis zum Fokuswechsel gerendert. Cmd+K-Aktionen stammen aus der bestehenden Action Registry und hängen nicht vom Mount der Zeile ab; Rollen und Bestätigungen bleiben identisch. Noch nicht geladene Datensätze erhalten dadurch keine zusätzlichen Zeilenaktionen.
- Tabellen behalten ihre semantischen Header. `aria-rowindex` bildet die logische Position einschließlich Header ab. `aria-rowcount` enthält die tatsächliche Gesamtzeilenzahl nur, wenn diese bekannt und passend zur Liste ist; bei unbekannter oder gedeckelter Gesamtzahl `-1`, niemals `1000` als angeblich vollständige Größe. Ladezustand, Ende, Grenze und Fehler werden zugänglich angekündigt. Eine tastaturbedienbare „Weitere laden“-Aktion ergänzt das automatische Nachladen.
- Mobile verwendet dieselben Daten in Kartenansicht (Bezug AUT-737), mit variablen Höhen über `measureElement`, stabilen IDs und Fokus-Erhalt. Karten nutzen passende Listen-Semantik statt Tabellen-ARIA ohne Tabelle. Desktop, 375/390 px, Reflow bei 320 px und 200 % Zoom werden geprüft. Deutsche UI-Texte und englische Übersetzungen entstehen nach ACP-i18n; die Formulierungen hier sind Entwurfstexte.

## 5. Auswahl, Massenaktionen und Export

- **Pilot:** Die Auswahl umfasst ausschließlich ausdrücklich gewählte, bereits geladene Datensatz-IDs; Virtualisierung hebt eine Auswahl nicht auf. „Alle geladenen auswählen (N)“ erfasst die zu diesem Zeitpunkt geladenen Zeilen. Später nachgeladene Zeilen werden nicht stillschweigend mit ausgewählt. Abwählen bleibt möglich. Suche, Filter, Sortierung, explizites Aktualisieren und Scope-Wechsel leeren die Auswahl; reines Nachladen nicht.
- Aktionen senden diese IDs und behalten die vorhandenen rollen-, status-, standort- und fiskalbezogenen Serverprüfungen je Datensatz. Nicht mehr vorhandene oder inzwischen unzulässige Datensätze folgen der Fehler-/Transaktionsregel der jeweiligen Aktion; die Migration darf sie nicht stillschweigend überspringen oder deren Prüfung abschwächen.
- Vorhandene Exporte behalten ihren ausdrücklich bezeichneten Umfang. Ein Export geladener oder ausgewählter Zeilen heißt auch so. Vorhandene serverseitige Gesamtexporte werden weiterverwendet; fehlende Gesamtexporte werden nicht durch Client-Nachladen aller Seiten ersetzt. Die UI bietet keine Aktion „Alle Treffer exportieren“ an, wenn der Endpunkt dies nicht unterstützt.
- **Separater Folgeschritt:** Auswahl aller Filtertreffer und neue serverseitige Gesamtexporte. Vor Umsetzung braucht dieser Schritt einen eigenen Vertrag zu Auswahlzeitpunkt versus Ausführungszeitpunkt, ausgeschlossenen IDs, Mengenbestätigung, erneuter Autorisierung, Nebenläufigkeit, Teilfehlern und Ausführungsgrenzen. Keine filterweite Mutation im Scrolling-Piloten.

## 6. Auswirkungen und ADR

Frontend-Plattform und die jeweiligen Listenmodule tragen die Migration gemeinsam. Sie betrifft mehrere Domänen und wird daher in Wellen umgesetzt. Additive Index-Migrationen sind je freigegebener Sortierung nötig; neue Entitäten oder Änderungen an Löschregeln, Geschäftsstatus, Nummerierung, Ledger oder Fiskalregeln sind nicht vorgesehen. Denormalisierte Spalten wären eine gesonderte Entscheidung.

[ADR-0035](../01-ADR/2026-11-02-cursor-based-infinite-lists.md) hält Cursor-/Fehlervertrag, Scope-Bindung, Sortier-Whitelist und Indexregel, Zählervertrag, Realtime-Verhalten, Auswahlgrenze und Expand/Contract-Plan als akzeptierte Architekturentscheidung fest. Dieses Konzept ergänzt die Details und Abnahmekriterien. Bezug: [OpenAPI / ADR-0010](../01-ADR/2026-04-12-openapi-contract-first.md), [Standort-Scope / ADR-0022](../01-ADR/2026-08-31-site-operational-scope.md), [Realtime](../01-ADR/2026-04-12-prisma-extends-realtime-sync.md).

API-Änderungen werden additiv eingeführt: vorhandene Offset-Verträge bleiben erhalten. Bei jeder späteren DTO-/Controller-Änderung müssen `apps/core-api/openapi/openapi.json` und `apps/core-web/src/api/generated/openapi.ts` regeneriert und gemeinsam committed werden (`npm --prefix apps/core-api run openapi:generate`, danach `npm --prefix apps/core-web run api:types:generate`). Dieser Dokument-PR ändert keine API-Artefakte.

## 7. Rollout und Abnahme

1. Auf Basis von ADR-0035 das Inventar der betroffenen Endpunkte/Views erstellen: je unterstütztem Sortierfeld und Richtung Cursor oder Offset festlegen; API-Verbraucher, Suchfelder, Exporte und Realtime-Invalidierungen erfassen.
2. Keyset-Helper, additive Index-Migrationen und Zählervertrag; erwartete Query-Pläne anhand repräsentativer Katalogdaten belegen.
3. Optionalen DataTable-Infinite-Modus einschließlich Auswahl, URL-/Zurück-Navigation, a11y und gezielter Invalidierung ergänzen.
4. Pilot: Fahrzeuge sowie Teile/Lager mit dokumentierten Cursor-Sorts; übrige Sortierungen bleiben über ihren vorhandenen Modus erreichbar. Pilot-Abnahme vor weiteren Wellen.
5. Rechnungen mit Nummer/Datum und eindeutiger ID; anschließend weitere Views in kleinen Wellen. Je Welle betroffene E2E-Tests im selben PR anpassen. Rückfall auf den weiterhin vorhandenen Offset-Modus bleibt bis zur Abnahme möglich.
6. Offset nur **pro Endpunkt und Sortierung** entfernen, nachdem alle zugehörigen Views, API-Verbraucher, gespeicherten Ansichten und Tests migriert sind. Relations-/Berechnungs-/Relevanz-Ausnahmen behalten Offset, bis ein gleichwertiger Ersatz ausdrücklich beschlossen und abgenommen ist; kein globales Löschdatum.

### Verbindliche Pilot-Prüfungen

- **Cursor:** ASC/DESC, gleiche Sortwerte, ausschließlich ID, NULL-Übergänge und nur NULL, leere/letzte Seite, gelöschte Cursorzeile, ungültiger Cursor, andere Filter/Endpunkte/Scopes, unveränderte Such-`OR`-Bedingungen sowie bisherige Standardgrößen, endpunktspezifische Obergrenzen (Fahrzeuge 50) und deren Clamping.
- **Isolation:** unzulässige Rolle (`403`), fremder Tenant, fremder oder entzogener Standort und fehlender aktiver Standort gemäß ADR-0022. Auch der Zähler und Folgeanfragen dürfen keine fremden Daten offenlegen.
- **Konsistenz:** neue Zeilen vor/nach dem Cursor, geänderte Sortwerte, Löschungen und Events während Nachladen/Aktualisieren. Keine sichtbaren doppelten IDs; die dokumentierte Live-Semantik und verbleibende Aktualisierungsmeldung werden geprüft.
- **Requests:** bei 2.000 geladenen Zeilen lösen Realtime-Ereignis, eigene Mutation, Focus, Reconnect oder erneutes Mounten einer gecachten Liste keine komplette Seitenkette aus. Änderungen von Suche, Filter oder Sortierung beginnen auch bei einem zuvor verwendeten, noch gecachten Query-Key frisch bei Seite eins und scrollen nach oben. Explizites Aktualisieren startet ebenfalls bei Seite eins und oben, ohne die bisherige Seitenkette zu refetchen. Schnelle Filterwechsel und wiederholte Ladeauslöser erzeugen weder parallele Fetches noch alte Ergebnisübernahmen. Der 2.000-Stopp, eine anfangs zu kurze Liste und Retry nach Nachladefehler werden geprüft.
- **Zähler/Aktionen:** 0/1.000/1.001 Treffer, Fehler und veraltete Antworten; Auswahl über virtualisierte Zeilen, neue Seiten und Filterwechsel; keine Aktionen auf Vorschauzeilen und kein versehentlich filterweiter Export oder Bulk-Aufruf.
- **Bedienung:** keyboard-only einschließlich Rendergrenzen und Cmd+K, Screenreader mit unbekannter Gesamtzahl, Zurück mit vorhandenem/fehlendem Cache, alte Seitenlinks, variable Kartenhöhen, mobile Breiten und Zoom.
- **Nachweise:** fokussierte lokale Checks nur für geänderte Workspaces/Specs, vollständige Suites in CI nach Repository-Regeln. Query-Pläne sowie Browser-Nachweise für Laden/Leer/Fehler/Geladen und Tastatur-/Mobile-Abnahme gehören zum Pilot-PR; Code-Health bleibt unverändert verpflichtend.

## Technische Referenzen

- [TanStack Query: Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) — sequenzieller Refetch geladener Seiten und Fetch-Koordination.
- [TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) — automatische Refetch-Auslöser einschließlich Mount, Focus und Reconnect.
- [PostgreSQL: Indexes and ORDER BY](https://www.postgresql.org/docs/current/indexes-ordering.html) — Scanrichtung und NULL-Reihenfolge.
