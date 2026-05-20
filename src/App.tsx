import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { DesignPanel } from "./components/DesignPanel";
import { DesignModeChoice } from "./components/DesignModeChoice";
import { Header } from "./components/Header";
import { LibraryScreen } from "./components/Library";
import { ModelingPanel } from "./components/ModelingPanel";
import { Onboarding } from "./components/Onboarding";
import { PowerBIVisualPanel } from "./components/PowerBIVisualPanel";
import { TableProposal } from "./components/TableProposal";
import { useChat } from "./hooks/useChat";
import { helper } from "./lib/helperClient";
import { buildFullPageReport } from "./lib/snippets";
import { loadState, resetState, saveState } from "./lib/storage";
import type {
  AppState,
  DesignMode,
  HelperStatus,
  LibraryProject,
  MCPTool,
  ProjectConfig,
  TableSuggestion,
} from "./types";

const DEFAULT_TARGET_DIR =
  (import.meta.env.VITE_DEFAULT_PBIP_DIR as string | undefined) ??
  "C:\\PowerBI\\viBI";

const HTML_INTERFACE_DESIGN_GUIDE =
  `INTERFACE-DESIGN-GUIDE FÜR HTML-DASHBOARDS (nach https://github.com/Dammyjay93/interface-design/blob/main/.claude/skills/interface-design/SKILL.md):\n` +
  `Baue keine generischen KPI-Kachel-Templates. Vor jedem großen HTML-Update musst du intern klären: Wer ist der konkrete Mensch, was muss er erledigen, wie soll es sich anfühlen?\n` +
  `Erkunde Domain, Farbwelt, Signature-Element und Defaults: mindestens 5 Domainbegriffe, 5 passende Farben aus der realen Produktwelt, ein wiedererkennbares Signature-Element und 3 Standard-Dashboard-Muster, die du bewusst ersetzt.\n` +
  `Jede Entscheidung braucht einen Grund: Layout, Farbtemperatur, Typografie, Spacing, Informationshierarchie. Wenn die Antwort nur "clean" oder "modern" ist, ist es zu generisch.\n` +
  `Nutze Design-Tokens mit sprechenden Namen, vier Text-Hierarchien, eine konsistente Spacing-Skala, subtile Layer statt harter Linien, klare Zustände und tabellarische Zahlen. Karten, Tabellen und Charts sollen jeweils für ihren Inhalt gestaltet sein, nicht als austauschbares Raster.\n` +
  `Vor dem Speichern prüfst du Swap-Test, Squint-Test, Signature-Test und Token-Test. Wenn der Entwurf ohne Produktname nicht erkennbar wäre, iteriere zuerst.\n\n`;

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [busy, setBusy] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);
  const chat = useChat(tools);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const refresh = useCallback(async () => {
    const s = await helper.status();
    setStatus(s);
    if (s.ok) {
      try {
        setTools(await helper.listMCPTools());
      } catch {
        setTools([]);
      }
    } else {
      setTools([]);
    }
    return s;
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  // Keep chat aware of the current project / phase
  useEffect(() => {
    if (!state.project) {
      chat.setExtraSystemPrompt(null);
      return;
    }
    const phaseLabel =
      state.phase === "design"
        ? state.designMode === "powerbi"
          ? "DESIGN (native PowerBI Visuals)"
          : state.designMode === "html"
          ? "DESIGN (HTML-Layout der Berichtsseite)"
          : "DESIGN (Auswahl HTML oder PowerBI Visuals)"
        : state.phase === "modeling"
        ? "DATENMODELL (Tabellen, Beziehungen, Measures, DAX)"
        : state.phase;
    const ctx =
      `AKTUELLER BERICHT:\n` +
      `- Name: ${state.project.name}\n` +
      `- Beschreibung/Ziel: ${state.project.goal}\n` +
      `- KPIs: ${state.project.kpis.join(", ") || "—"}\n` +
      `- Aktive Phase: ${phaseLabel}\n` +
      (state.pbipPath ? `- PBIP-Pfad: ${state.pbipPath}\n` : "") +
      (state.suggestion
        ? `- Vorgeschlagene Tabellen: ${state.suggestion.tables
            .map((t) => t.name)
            .join(", ")}\n`
        : "") +
      (state.designMode
        ? `- Gewählter Designweg: ${state.designMode === "html" ? "HTML" : "PowerBI Visuals"}\n`
        : "") +
      `\nDATENQUELLEN-HINWEIS: Business Central kann eine Quelle sein, ist aber NICHT verbindlich. Im Design- und Visual-Schritt gilt ausschließlich, was list_model/read_pbip_metadata im aktuellen PowerBI-Modell tatsächlich findet. Wenn andere Tabellen vorhanden sind, verwende diese ohne Rückfrage nach Business-Central-Tabellen.\n\n` +
      `AUTO-DATE-SCHUTZ (sehr wichtig, häufige Fehlerquelle):\n` +
      `Power BI Desktop legt für jede dateTime-Spalte AUTOMATISCH eine versteckte Tabelle 'LocalDateTable_<guid>' (und einmalig 'DateTableTemplate_<guid>') sowie zugehörige Beziehungen an. Diese erscheinen NICHT in list_model/read_pbip_metadata, weil viBI sie für deine Sicht ausblendet. Konsequenzen:\n` +
      `  • REFERENZIERE NIE eine LocalDateTable_* oder DateTableTemplate_* in irgendeinem Tool-Aufruf (add_measure, add_relationship, add_calculated_column, remove_relationship, replace_in_html, …). Sie sind PBI-intern und tabu.\n` +
      `  • Wenn du eine Datums-Dimension brauchst (Beziehung von Sales.Date → Date.Date, Slicer, USERELATIONSHIP etc.), benutze ausschließlich die viBI-eigene Tabelle 'Date'.\n` +
      `  • Falls ein Tool-Aufruf eine Auto-Date-Tabelle berührt, lehnt der Helper hart ab mit einem Fehler. Lies die Fehlermeldung und versuche es mit der echten Tabelle erneut.\n` +
      `  • fix_ambiguous_relationships, restore_tmdl_backup und remove_relationship lassen Auto-Date-Beziehungen unangetastet – das ist Absicht und nicht zu umgehen.\n\n` +
      (state.phase === "design" && state.designMode === "html"
        ? `DESIGN-PHASE-FOKUS:\n` +
          HTML_INTERFACE_DESIGN_GUIDE +
          `Du bist NICHT mehr in der Modellierung. KEINE add_relationship / add_calculated_*-TMDL-Tools mehr aufrufen, außer der User fragt explizit nach DAX/Beziehungen. ` +
          `Das Layout der Berichtsseite ist ein einzelnes vollständiges HTML-Dokument, das in Power BI über das 'HTML Content'-Custom-Visual von https://html-content.com gerendert wird. Es lebt im Helper als .vibi-design.html.\n\n` +
          `LIVE-WERTE im HTML (sehr wichtig):\n` +
          `Damit Zahlen aus den im Modellierungs-Schritt angelegten Measures (Gesamtumsatz, Anzahl Kunden etc.) im Dashboard live erscheinen, NUTZE PLACEHOLDER-Syntax im HTML:\n` +
          `  • {{Measure}}                 z.B. {{Gesamtumsatz}}                → FORMAT([Gesamtumsatz], "#,##0.##")\n` +
          `  • {{Tabelle[Measure]}}        z.B. {{Invoices[Anzahl Kunden]}}     → FORMAT([Anzahl Kunden], "#,##0.##")\n` +
          `  • {{Measure:format}}          z.B. {{Gesamtumsatz:€#,##0.00}}      → FORMAT([Gesamtumsatz], "€#,##0.00")\n` +
          `  • {{Tabelle[Measure]:format}} z.B. {{Invoices[Wachstum]:0.0%}}     → FORMAT([Wachstum], "0.0%")\n` +
          `Beim Embed (embed_full_page_html / In-Bericht-einbetten) wandelt viBI diese Placeholder in eine DAX-Konkatenation um, sodass die Measure 'Dashboard HTML' das HTML mit echten Werten produziert. In der Live-Vorschau werden Placeholder als gelbe Chips mit Beispiel-Zahlen angezeigt – das ist erwartet, im PBI-Bericht stehen dort die echten Werte.\n\n` +
          `WICHTIG: Schreibe NIEMALS die Werte fest in HTML. Statt <div class="value">1.234</div> immer <div class="value">{{MeasureName}}</div>. Die Format-Suffixe wählst du KPI-spezifisch: Geld → "€#,##0.00" / "#,##0 €", Prozent → "0.0%", Anzahl → "#,##0", Datum → "DD.MM.YYYY".\n\n` +
          `EMBEDDING-MECHANISMUS (sehr wichtig zu verstehen):\n` +
          `embed_full_page_html macht beim Aufruf DREI Dinge gleichzeitig:\n` +
          `  • Schreibt das HTML als DAX-Stringliteral in eine Measure 'Dashboard HTML' (Tabelle 'Date', Anzeige-Ordner '_viBI'). Idempotent (replace=true).\n` +
          `  • PLATZIERT auf Seite 1 ein page-fillendes 'HTML Content'-Visual (von https://html-content.com) und bindet die Measure ans 'Values'-Feld. Der User muss NICHT mehr selbst Visual + Bindung machen.\n` +
          `  • Sichert eine standalone vibi-design.html in StaticResources als Backup.\n` +
          `Einzige verbleibende User-Aktion: einmalig die Erweiterung von https://html-content.com installieren, falls PBI Desktop 'Visual fehlt' anzeigt – Bindung und Position bleiben dabei erhalten.\n\n` +
          `ANTI-LOOP-REGEL (das Wichtigste): Schreibe NIEMALS Sätze wie „Ich aktualisiere jetzt das Design" / „Ich rufe X auf" / „Ich werde das ändern" OHNE im selben Turn den Tool-Aufruf zu machen. Tool-Calls passieren über functionCall, nicht in deinem Antworttext. Wenn du nur beschreibst was du tun willst, passiert NICHTS – die Live-Vorschau bleibt unverändert und der User wartet umsonst. Reihenfolge: ERST tool_call, DANN Text-Bestätigung mit dem 'summary'-Feld aus dem Tool-Resultat.\n\n` +
          `WERKZEUG-WAHL (wichtig für Performance):\n` +
          `  • Für KLEINE Änderungen (Farbe, einzelner Text, Wert) IMMER replace_in_html nutzen. Beispiel: User sagt „mach das Gelb grau" → replace_in_html({find: "#F2C811", replaceWith: "#CCCCCC"}). Du musst NICHT vorher get_full_page_html aufrufen, wenn du den find-String sicher kennst. Spart Tokens und ist schneller.\n` +
          `  • Für MITTLERE Änderungen mit unklarem find-String: zuerst get_full_page_html, dann ein oder mehrere replace_in_html-Aufrufe.\n` +
          `  • Für GROSSE Restrukturierungen (Layout-Umbau, neue Section): get_full_page_html → komplette neue HTML im Kopf bauen → update_full_page_html mit dem ganzen Dokument.\n` +
          `  • embed_full_page_html NUR wenn der User explizit „in PBI einbetten" sagt – nicht bei jedem kleinen Tweak.\n\n` +
          `Workflow:\n` +
          `1. Tool aufrufen (replace_in_html für klein, get→update für groß).\n` +
          `2. Antwort: kurze Bestätigung in 1-2 Sätzen + summary aus dem Tool-Resultat. Nicht den geänderten HTML-Code in die Chat-Antwort schreiben (zu lang, sinnlos).\n` +
          `3. Live-Vorschau im DesignPanel polled jede 1.5s den Helper – Änderung wird automatisch sichtbar.\n\n` +
          `WICHTIG für update_full_page_html: Niemals halbe Snippets zurückliefern. Das HTML muss IMMER ein vollständiges Dokument mit <html><head><style>...</style></head><body>...</body></html> sein. Inline-CSS bevorzugen. Keine externen Bilder, keine externen Fonts (außer Web-Safe Stack), keine fetch-Aufrufe – das Visual läuft im sandboxed iframe ohne Netz.\n\n`
        : "") +
      (state.phase === "design" && state.designMode === "powerbi"
        ? `POWERBI-VISUALS-PHASE-FOKUS:\n` +
          `Du erstellst KEIN HTML und nutzt keine HTML-Content-Visuals. Ziel ist ein nativer PowerBI-Bericht mit Slicern, Beziehungen, Measures und direkt gebundenen Standard-Visuals.\n\n` +
          `Verbindliche Regeln:\n` +
          `1. Immer zuerst list_model aufrufen. Keine Tabellen- oder Spaltennamen erfinden. Die Tabellen aus list_model sind die Wahrheit, auch wenn sie von früheren Vorschlägen oder Business-Central-Beispielen abweichen.\n` +
          `2. Wenn list_model nutzbare Tabellen/Spalten enthält, arbeite damit weiter. Bitte den User NICHT, Business-Central-Tabellen zu laden, nur weil erwartete Namen fehlen.\n` +
          `3. Filter werden ausschließlich als Slicer umgesetzt. Wähle aus vorhandenen Datums-, Jahr/Monat-, Status-, Kategorie-, Kunden-, Artikel- oder Regionsspalten sinnvolle Slicer oder übergib sie an create_powerbi_report_visuals.\n` +
          `4. Beziehungen zwischen Tabellen müssen hergestellt werden, wenn mehrere Tabellen für KPIs/Filter/Visuals zusammenwirken. Nutze add_relationship nur mit echten Spalten aus list_model und vermeide Duplikate. WICHTIG: Vermeide auch indirekte Mehrfachpfade (z.B. A→B→C plus A→C). Wenn verify_model activePathConflicts meldet oder PBI PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH zeigt, sofort fix_ambiguous_relationships aufrufen und danach verify_model erneut.\n` +
          `5. Visuals müssen direkt im Bericht landen: create_powerbi_report_visuals schreibt Slicer, KPI-Karten, Balkendiagramm und Tabelle in report.json und bindet sie an Measures/Spalten.\n` +
          `6. verify_model nach add_measure/add_relationship aufrufen. Wenn verify_model Probleme meldet, nicht einfach weiterdesignen, sondern korrigieren oder klar melden.\n` +
          `7. Nach Schreib-Tools immer den Reload-Hinweis nennen: PBI Desktop schließen ohne Speichern, dann erneut öffnen.\n\n`
        : "") +
      `VERFÜGBARE TOOLS (server="helper"):\n` +
      `- read_pbip_metadata({pbipPath}): kurze Tabellen-/Spalten-Übersicht.\n` +
      `- list_model({pbipPath}): vollständiger TMDL-Zustand inkl. Measures und Beziehungen.\n` +
      `- add_measure({pbipPath, table, name, expression, formatString?, displayFolder?, replace?}): DAX-Measure anlegen. **Standard-Werkzeug für KPIs.** Pflicht: rufe ZUERST list_model auf und prüfe, ob der Name schon vergeben ist. Bei identischem Ausdruck → nicht erneut anlegen (der Helper ist idempotent). Bei abweichendem Ausdruck entweder anderen Namen wählen oder explizit replace=true setzen, sonst lehnt der Helper hart ab (PBI würde sonst „TMDL-Objekte können nicht zusammengeführt werden" werfen).\n` +
      `- add_date_table({pbipPath, name?, startDate?, endDate?}): kalkulierte Datumstabelle (Date + Year/Quarter/Month/MonthName/YearMonth) anlegen.\n` +
      `- add_calculated_table({pbipPath, name, expression, dataCategory?}): beliebige neue kalkulierte Tabelle anlegen (z.B. SUMMARIZE, DISTINCT). Single-line.\n` +
      `- add_calculated_column({pbipPath, table, name, expression, dataType?, formatString?, summarizeBy?}): calc column hinzufügen.\n` +
      `- add_relationship({...}) / remove_relationship({pbipPath, id}): NUR auf explizite User-Anforderung. Standard-Workflow legt KEINE Beziehungen an, weil das HTML-Dashboard ohne sie auskommt und sie die häufigste Fehlerquelle sind.\n` +
      `- fix_ambiguous_relationships({pbipPath}): Recovery-Tool – entfernt Duplikate, deaktiviert mehrfach-aktive Beziehungen und bricht aktive Alternativpfade/Zyklen (A→B→C plus A→C) auf.\n` +
      `- restore_tmdl_backup({pbipPath}): Recovery-Tool – stellt den Stand vor der letzten viBI-Änderung wieder her.\n` +
      `- locate_pbip({name?}): Bibliotheks-Suche.\n` +
      `- get_full_page_html({pbipPath}): aktuelles Design-HTML lesen (Design-Phase).\n` +
      `- replace_in_html({pbipPath, find, replaceWith, all?}): SURGISCHER find/replace im Design-HTML – das bevorzugte Tool für kleine Änderungen (Farben, Werte, Texte). Spart Tokens.\n` +
      `- update_full_page_html({pbipPath, html}): komplettes Design-HTML neu schreiben (für große Layout-Umbauten).\n` +
      `- embed_full_page_html({pbipPath, html?}): Measure schreiben + Visual auf Seite 1 platzieren.\n` +
      `- apply_full_page_html({pbipPath, html}): Alias zu embed_full_page_html.\n` +
      `- create_powerbi_report_visuals({pbipPath, title?, measureNames?, slicers?, category?}): native PowerBI-Visuals inklusive Slicer, KPI-Karten, Balkendiagramm und Tabelle direkt in report.json schreiben.\n` +
      `- run_fabric_modeling: nur falls Fabric-MCP verbunden, sonst die obigen Tools verwenden.\n\n` +
      `WICHTIG: Wenn der User „modelliere" oder „verbinde dich mit dem Bericht" sagt, RUFE DIE TOOLS DIREKT AUF. Behaupte NIE, du könntest das nicht. ` +
      `Nach Schreib-Tools (add_*) erwähnst du im Antworttext den reloadHint aus dem Tool-Resultat (PBI Desktop neu öffnen).\n\n` +
      `DATENQUELLEN-LOGIK: Tools liefern in 'source' entweder 'live-workspace' (PBI Desktop hat den Bericht aktuell offen) oder 'tmdl' (gelesen aus der Datei). ` +
      `Wenn read_pbip_metadata 'source' = 'none' liefert oder isPlaceholder=true zurückgibt: rufe SOFORT find_pbips auf (mit nameContains=Projektname), schau in das Ergebnis und wähle den .pbip mit dem passenden Namen. Erst wenn auch find_pbips leer ist, sage dem User, dass er Strg+S in PBI Desktop drücken soll. ` +
      `Erfinde NIE Tabellen, die nicht in einem Tool-Resultat 'tables' stehen.\n\n` +
      `MODELLIERUNGS-REIHENFOLGE (verbindlich):\n` +
      `1. Zuerst IMMER list_model aufrufen. Erfinde NIE Spaltennamen – nimm sie 1:1 aus list_model.tables[].columns[].name.\n` +
      `2. add_date_table NUR wenn list_model keine Tabelle namens 'Date' enthält. Frische viBI-Projekte haben bereits eine.\n` +
      `3. Pro KPI EIN add_measure aufrufen. Der DAX-Ausdruck soll AUF EINE TABELLE bezogen sein, außer der PowerBI-Visuals-Pfad verlangt eine sauber verifizierte Beziehung.\n` +
      (state.designMode === "powerbi"
        ? `4. Für native PowerBI Visuals: fehlende Beziehungen per add_relationship herstellen und in verify_model als expectedRelationships prüfen. Wenn verify_model ambiguousPaths oder activePathConflicts meldet, fix_ambiguous_relationships ausführen und erneut verifizieren, bevor Visuals erstellt werden.\n`
        : `4. Im HTML-Pfad KEINE add_relationship-Aufrufe, außer der User fragt explizit nach Beziehungen. Das HTML-Dashboard rendert Werte über Measure-Strings.\n`) +
      `5. NACH ALLEN SCHREIB-TOOLS: verify_model mit expectedTables, expectedMeasures und – im PowerBI-Visuals-Pfad – expectedRelationships aufrufen.\n` +
      `6. AM ENDE eine kurze deutsche Bullet-Antwort: welche Measures angelegt (mit Formel), Reload-Hinweis (Datei→schließen ohne Speichern→erneut öffnen). Kein Kommentar = User denkt du hängst.\n\n` +
      `BEZIEHUNGS-RECOVERY-WERKZEUGE (nur falls explizit angefragt oder Bericht beschädigt): add_relationship, remove_relationship, fix_ambiguous_relationships, restore_tmdl_backup. Wenn der User berichtet, dass PBI Desktop beim Öffnen einen Fehler wirft (Variation-Pfad / mehrdeutige Beziehungen / TMDL-Format), rufe SOFORT restore_tmdl_backup auf.`;
    chat.setExtraSystemPrompt(ctx);
    chat.setToolArgDefaults({
      pbipPath: state.pbipPath,
      goal: state.project.goal,
      kpis: state.project.kpis,
      tables: state.suggestion?.tables.map((t) => t.name),
    });
  }, [state.project, state.suggestion, state.pbipPath, state.phase, state.designMode]);

  // First boot: route to library if helper has projects
  useEffect(() => {
    if (bootChecked) return;
    if (state.project) {
      setBootChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const s = await refresh();
      if (cancelled) return;
      if (s.ok) {
        try {
          const lib = await helper.library();
          if (!cancelled && lib.projects.length > 0) {
            setState((st) => ({ ...st, phase: "library" }));
          }
        } catch {
          /* fall through to onboarding */
        }
      }
      if (!cancelled) setBootChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootChecked, refresh, state.project]);

  const onOnboardingFinish = async (project: ProjectConfig) => {
    setBusy(true);
    setState((s) => ({ ...s, project }));
    try {
      const r = await helper.createProject(project, DEFAULT_TARGET_DIR);
      setState((s) => ({
        ...s,
        project,
        pbipPath: r.path,
        libraryId: r.libraryId,
        phase: "modeling",
        modelingStep: "proposal",
      }));
      // Power BI Desktop automatisch öffnen. Fehler nicht mehr stumm
      // verschlucken – sonst wundert sich der User, warum nichts passiert.
      try {
        const openRes = await helper.openPowerBIDesktop(r.path);
        if (!openRes?.ok) {
          chat.seedAssistant(
            `⚠ Konnte Power BI Desktop nicht automatisch öffnen. Bitte starte PBI Desktop manuell und öffne dort die Datei:\n\n${r.path}`
          );
        }
      } catch (e) {
        chat.seedAssistant(
          `⚠ Konnte Power BI Desktop nicht automatisch öffnen (${(e as Error).message}).\n\n` +
            `Wahrscheinliche Ursachen:\n` +
            `• PBI Desktop ist nicht installiert oder die exe liegt an einem nicht-Standard-Pfad → setze beim Helper-Start die Umgebungsvariable POWERBI_DESKTOP_PATH auf die volle PBIDesktop.exe.\n` +
            `• Helper läuft nicht oder /powerbi/open ist blockiert.\n\n` +
            `Datei manuell öffnen: ${r.path}`
        );
      }
    } catch (e) {
      alert(
        `Projekt konnte nicht erstellt werden: ${(e as Error).message}\n\n` +
          "Läuft der Helper? Phase wird trotzdem gesetzt – du kannst es später erneut versuchen."
      );
      setState((s) => ({
        ...s,
        project,
        phase: "modeling",
        modelingStep: "proposal",
      }));
    } finally {
      setBusy(false);
    }
  };

  const onAcceptTables = async (suggestion: TableSuggestion) => {
    if (!state.project) return;
    setState((s) => ({ ...s, suggestion, modelingStep: "working" }));
    // Chat-getriebene Basismodellierung: zuerst Measures stabil anlegen.
    // Beziehungen werden im PowerBI-Visuals-Pfad nach der Designweg-Auswahl
    // gezielt ergänzt und verifiziert; HTML-Dashboards brauchen sie nicht.
    const tableLine = suggestion.tables
      .map((t) => `${t.name} (${t.keyColumns.join(", ")})`)
      .join("\n - ");
    const kpiLine = state.project.kpis.length
      ? state.project.kpis.join(", ")
      : "(keine konkreten KPIs angegeben – nutze sinnvolle Kennzahlen aus dem tatsächlich geladenen Modell)";
    chat.send(
      `Modelliere jetzt den Bericht „${state.project.name}" für mich. Ziel: ${state.project.goal}\n\n` +
        `Geladene Tabellen:\n - ${tableLine}\n\n` +
        `Geplante KPIs: ${kpiLine}\n\n` +
        `Schritte:\n` +
        `1. list_model aufrufen, um den aktuellen TMDL-Zustand zu sehen.\n` +
        `2. Pro KPI ein passendes DAX-Measure via add_measure anlegen. Der Ausdruck soll erst einmal PER TABELLE aggregieren (z.B. SUM(Sales[Quantity]), AVERAGE(Customer[CreditLimit])). displayFolder: "Measures".\n` +
        `3. Beziehungen jetzt nur anlegen, wenn sie eindeutig aus list_model hervorgehen. Spätestens im späteren PowerBI-Visuals-Pfad werden fehlende Beziehungen gezielt ergänzt und verifiziert.\n` +
        `4. verify_model mit expectedMeasures aufrufen; expectedRelationships nur setzen, wenn du wirklich Beziehungen angelegt hast.\n` +
        `5. Am Ende eine kurze deutsche Zusammenfassung: welche Measures angelegt, ein Bullet pro Measure mit Name + Formel, plus Reload-Hinweis (Datei→schließen ohne Speichern→neu öffnen).`
    );
  };

  const onRequestDifferentTables = (suggestion: TableSuggestion) => {
    if (!state.project) return;
    setState((s) => ({ ...s, suggestion }));
    chat.seedAssistant(
      `Verstanden – sag mir, welche Tabellen du stattdessen verwenden möchtest. Ich validiere sie gegen deine ursprüngliche Anforderung:\n\n` +
        `> ${state.project.goal}\n\n` +
        `Bisher hatte ich vorgeschlagen: ${suggestion.tables
          .map((t) => t.name)
          .join(", ")}.\n\n` +
        `Was soll stattdessen rein – und welche Spalten brauchst du?`
    );
  };

  const onFinishModeling = async () => {
    if (!state.project) return;
    setBusy(true);
    try {
      if (state.pbipPath) {
        try {
          await helper.readProjectMetadata(state.pbipPath);
        } catch {
          /* optional */
        }
        try {
          await helper.closePowerBIDesktop();
        } catch {
          /* user may have closed already */
        }
      }
      setState((s) => ({
        ...s,
        phase: "design",
        designMode: undefined,
      }));
      chat.seedAssistant(
        `Datenmodellierung ist abgeschlossen. Ich bin jetzt in **Phase 2: Design**.\n\n` +
          `Bitte wähle links den Designweg: **Über HTML erstellen** für ein frei gestaltetes Dashboard oder **PowerBI Visuals** für native Slicer, Beziehungen und direkt gebundene Bericht-Visuals.`
      );
    } finally {
      setBusy(false);
    }
  };

  const setFullPageHtml = (html: string) =>
    setState((s) => ({ ...s, fullPageHtml: html }));

  const onSelectDesignMode = async (designMode: DesignMode) => {
    if (!state.project) return;
    if (designMode === "html") {
      const html = state.fullPageHtml ?? buildFullPageReport(state.project);
      if (state.pbipPath) {
        try {
          await helper.saveDesignHtml(state.pbipPath, html);
        } catch {
          /* helper offline – DesignPanel pusht später erneut */
        }
      }
      setState((s) => ({ ...s, designMode, fullPageHtml: html }));
      chat.seedAssistant(
        `HTML-Designweg gewählt. Ich nutze jetzt den Interface-Design-Leitfaden: erst Domain/Farbwelt/Signature/Defaults prüfen, dann ein vollständiges HTML-Dokument mit dynamischen {{Measure}}-Platzhaltern gestalten.`
      );
      return;
    }

    setState((s) => ({ ...s, designMode }));
    chat.seedAssistant(
      `PowerBI-Visuals gewählt. Ich erstelle kein HTML, sondern arbeite mit list_model, add_measure, add_relationship, verify_model und create_powerbi_report_visuals. Filter werden als Slicer umgesetzt.`
    );
  };

  const openLibraryProject = (p: LibraryProject) => {
    const project: ProjectConfig = {
      name: p.name,
      fileName: p.fileName,
      reportType: "report",
      goal: p.goal,
      ci: p.ci,
      kpis: p.kpis,
      createdAt: p.createdAt,
    };
    setState({
      phase: "modeling",
      modelingStep: "working",
      project,
      pbipPath: p.pbipPath,
      libraryId: p.id,
      snippets: [],
      designMode: undefined,
    });
  };

  const goToLibrary = () => setState((s) => ({ ...s, phase: "library" }));
  const startNew = () =>
    setState({
      phase: "onboarding",
      snippets: [],
      project: undefined,
      modelingStep: undefined,
      suggestion: undefined,
      designMode: undefined,
      fullPageHtml: undefined,
    });

  const restart = () => {
    if (!confirm("Zurück zur Bibliothek? Aktuelle Sitzung wird verworfen (Berichte bleiben erhalten).")) return;
    resetState();
    location.reload();
  };

  if (!bootChecked) {
    return (
      <div
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
        }}
      >
        Lade…
      </div>
    );
  }

  if (state.phase === "library") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <Header
          status={status}
          toolCount={tools.length}
          onRefresh={refresh}
          project={state.project}
          phase={state.phase}
          onRestart={restart}
          onLibrary={goToLibrary}
        />
        <LibraryScreen
          helperOnline={status?.ok === true}
          onOpen={openLibraryProject}
          onNew={startNew}
          onClose={state.project ? () => setState((s) => ({ ...s, phase: "modeling" })) : undefined}
        />
      </div>
    );
  }

  if (state.phase === "onboarding" || !state.project) {
    return <Onboarding onFinish={onOnboardingFinish} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header
        status={status}
        onRefresh={refresh}
        project={state.project}
        phase={state.phase}
        onRestart={restart}
        onLibrary={goToLibrary}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {state.phase === "modeling" && state.modelingStep === "proposal" && (
          <TableProposal
            project={state.project}
            initial={state.suggestion}
            onAccept={onAcceptTables}
            onRequestDifferent={onRequestDifferentTables}
          />
        )}
        {state.phase === "modeling" &&
          (state.modelingStep === "working" || !state.modelingStep) && (
            <ModelingPanel
              project={state.project}
              pbipPath={state.pbipPath}
              suggestion={state.suggestion}
              onFinishModeling={onFinishModeling}
              onBackToProposal={() =>
                setState((s) => ({ ...s, modelingStep: "proposal" }))
              }
              busy={busy}
            />
          )}
        {state.phase === "design" && !state.designMode && (
          <DesignModeChoice project={state.project} onSelect={onSelectDesignMode} />
        )}
        {state.phase === "design" && state.designMode === "html" && (
          <DesignPanel
            project={state.project}
            pbipPath={state.pbipPath}
            html={state.fullPageHtml ?? buildFullPageReport(state.project)}
            onChange={setFullPageHtml}
          />
        )}
        {state.phase === "design" && state.designMode === "powerbi" && (
          <PowerBIVisualPanel
            project={state.project}
            pbipPath={state.pbipPath}
            suggestion={state.suggestion}
          />
        )}
        <ChatPanel
          messages={chat.messages}
          busy={chat.busy}
          error={chat.error}
          onSend={chat.send}
          onReset={chat.reset}
        />
      </div>
    </div>
  );
}
