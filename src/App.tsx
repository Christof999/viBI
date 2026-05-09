import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { DesignPanel } from "./components/DesignPanel";
import { Header } from "./components/Header";
import { LibraryScreen } from "./components/Library";
import { ModelingPanel } from "./components/ModelingPanel";
import { Onboarding } from "./components/Onboarding";
import { TableProposal } from "./components/TableProposal";
import { useChat } from "./hooks/useChat";
import { helper } from "./lib/helperClient";
import { buildFullPageReport } from "./lib/snippets";
import { loadState, resetState, saveState } from "./lib/storage";
import type {
  AppState,
  HelperStatus,
  LibraryProject,
  MCPTool,
  ProjectConfig,
  TableSuggestion,
} from "./types";

const DEFAULT_TARGET_DIR =
  (import.meta.env.VITE_DEFAULT_PBIP_DIR as string | undefined) ??
  "C:\\PowerBI\\viBI";

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
        ? "DESIGN (HTML-Layout der Berichtsseite)"
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
      `\nMETA: Alle Niederlassungen nutzen Microsoft Dynamics 365 Business Central als ERP.\n\n` +
      (state.phase === "design"
        ? `DESIGN-PHASE-FOKUS:\n` +
          `Du bist NICHT mehr in der Modellierung. KEINE add_relationship / add_calculated_*-TMDL-Tools mehr aufrufen, außer der User fragt explizit nach DAX/Beziehungen. ` +
          `Das Layout der Berichtsseite ist ein einzelnes vollständiges HTML-Dokument, das in Power BI über das 'HTML Content'-Custom-Visual von https://html-content.com gerendert wird. Es lebt im Helper als .vibi-design.html.\n\n` +
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
      `VERFÜGBARE TOOLS (server="helper"):\n` +
      `- read_pbip_metadata({pbipPath}): kurze Tabellen-/Spalten-Übersicht.\n` +
      `- list_model({pbipPath}): vollständiger TMDL-Zustand inkl. Measures und Beziehungen.\n` +
      `- add_measure({pbipPath, table, name, expression, formatString?, displayFolder?}): DAX-Measure anlegen. **Standard-Werkzeug für KPIs.**\n` +
      `- add_date_table({pbipPath, name?, startDate?, endDate?}): kalkulierte Datumstabelle (Date + Year/Quarter/Month/MonthName/YearMonth) anlegen.\n` +
      `- add_calculated_table({pbipPath, name, expression, dataCategory?}): beliebige neue kalkulierte Tabelle anlegen (z.B. SUMMARIZE, DISTINCT). Single-line.\n` +
      `- add_calculated_column({pbipPath, table, name, expression, dataType?, formatString?, summarizeBy?}): calc column hinzufügen.\n` +
      `- add_relationship({...}) / remove_relationship({pbipPath, id}): NUR auf explizite User-Anforderung. Standard-Workflow legt KEINE Beziehungen an, weil das HTML-Dashboard ohne sie auskommt und sie die häufigste Fehlerquelle sind.\n` +
      `- fix_ambiguous_relationships({pbipPath}): Recovery-Tool – entfernt Duplikate, deaktiviert mehrfach-aktive Beziehungen.\n` +
      `- restore_tmdl_backup({pbipPath}): Recovery-Tool – stellt den Stand vor der letzten viBI-Änderung wieder her.\n` +
      `- locate_pbip({name?}): Bibliotheks-Suche.\n` +
      `- get_full_page_html({pbipPath}): aktuelles Design-HTML lesen (Design-Phase).\n` +
      `- replace_in_html({pbipPath, find, replaceWith, all?}): SURGISCHER find/replace im Design-HTML – das bevorzugte Tool für kleine Änderungen (Farben, Werte, Texte). Spart Tokens.\n` +
      `- update_full_page_html({pbipPath, html}): komplettes Design-HTML neu schreiben (für große Layout-Umbauten).\n` +
      `- embed_full_page_html({pbipPath, html?}): Measure schreiben + Visual auf Seite 1 platzieren.\n` +
      `- apply_full_page_html({pbipPath, html}): Alias zu embed_full_page_html.\n` +
      `- run_fabric_modeling: nur falls Fabric-MCP verbunden, sonst die obigen Tools verwenden.\n\n` +
      `WICHTIG: Wenn der User „modelliere" oder „verbinde dich mit dem Bericht" sagt, RUFE DIE TOOLS DIREKT AUF. Behaupte NIE, du könntest das nicht. ` +
      `Nach Schreib-Tools (add_*) erwähnst du im Antworttext den reloadHint aus dem Tool-Resultat (PBI Desktop neu öffnen).\n\n` +
      `DATENQUELLEN-LOGIK: Tools liefern in 'source' entweder 'live-workspace' (PBI Desktop hat den Bericht aktuell offen) oder 'tmdl' (gelesen aus der Datei). ` +
      `Wenn read_pbip_metadata 'source' = 'none' liefert oder isPlaceholder=true zurückgibt: rufe SOFORT find_pbips auf (mit nameContains=Projektname), schau in das Ergebnis und wähle den .pbip mit dem passenden Namen. Erst wenn auch find_pbips leer ist, sage dem User, dass er Strg+S in PBI Desktop drücken soll. ` +
      `Erfinde NIE Tabellen, die nicht in einem Tool-Resultat 'tables' stehen.\n\n` +
      `MODELLIERUNGS-REIHENFOLGE (verbindlich):\n` +
      `1. Zuerst IMMER list_model aufrufen. Erfinde NIE Spaltennamen – nimm sie 1:1 aus list_model.tables[].columns[].name.\n` +
      `2. add_date_table NUR wenn list_model keine Tabelle namens 'Date' enthält. Frische viBI-Projekte haben bereits eine.\n` +
      `3. Pro KPI EIN add_measure aufrufen. Der DAX-Ausdruck soll AUF EINE TABELLE bezogen sein (SUM(Sales[Quantity]), AVERAGE(Customer[Score]) etc.). Cross-table-Logik (RELATED, USERELATIONSHIP) NICHT verwenden.\n` +
      `4. KEINE add_relationship-Aufrufe! Hintergrund: Das spätere HTML-Dashboard rendert seine Werte über das Measure-HTML, nicht über Power-BI-Joins. Tabellen-Beziehungen sind für den Dashboard-Output IRRELEVANT und nur eine Fehlerquelle (mehrdeutige Pfade, fehlende Spalten, kaputte Variations). Wenn der User explizit „lege Beziehung X→Y an" sagt, dann – und nur dann – darfst du add_relationship benutzen. Sonst nicht.\n` +
      `5. NACH ALLEN SCHREIB-TOOLS: verify_model mit expectedTables und expectedMeasures aufrufen (expectedRelationships leer lassen).\n` +
      `6. AM ENDE eine kurze deutsche Bullet-Antwort: welche Measures angelegt (mit Formel), Reload-Hinweis (Datei→schließen ohne Speichern→erneut öffnen). Kein Kommentar = User denkt du hängst.\n\n` +
      `BEZIEHUNGS-RECOVERY-WERKZEUGE (nur falls explizit angefragt oder Bericht beschädigt): add_relationship, remove_relationship, fix_ambiguous_relationships, restore_tmdl_backup. Wenn der User berichtet, dass PBI Desktop beim Öffnen einen Fehler wirft (Variation-Pfad / mehrdeutige Beziehungen / TMDL-Format), rufe SOFORT restore_tmdl_backup auf.`;
    chat.setExtraSystemPrompt(ctx);
    chat.setToolArgDefaults({
      pbipPath: state.pbipPath,
      goal: state.project.goal,
      kpis: state.project.kpis,
      tables: state.suggestion?.tables.map((t) => t.name),
    });
  }, [state.project, state.suggestion, state.pbipPath, state.phase]);

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
      try {
        await helper.openPowerBIDesktop(r.path);
      } catch {
        /* user can open manually */
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
    // Chat-getriebene Modellierung. WICHTIG: Da das spätere HTML-Dashboard
    // ein gerendertes HTML-Visual ist (Werte hartkodiert in der DAX-Measure),
    // brauchen wir KEINE Tabellen-Beziehungen im Modell. Skipping
    // add_relationship eliminiert die häufigste Fehlerklasse
    // (PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH, broken column refs,
    // variation-orphans). Falls der User später echte cross-table-DAX braucht,
    // kann er Beziehungen explizit anlegen.
    const tableLine = suggestion.tables
      .map((t) => `${t.name} (${t.keyColumns.join(", ")})`)
      .join("\n - ");
    const kpiLine = state.project.kpis.length
      ? state.project.kpis.join(", ")
      : "(keine konkreten KPIs angegeben – schlage typische BC-KPIs vor)";
    chat.send(
      `Modelliere jetzt den Bericht „${state.project.name}" für mich. Ziel: ${state.project.goal}\n\n` +
        `Geladene Tabellen:\n - ${tableLine}\n\n` +
        `Geplante KPIs: ${kpiLine}\n\n` +
        `Schritte:\n` +
        `1. list_model aufrufen, um den aktuellen TMDL-Zustand zu sehen.\n` +
        `2. Pro KPI ein passendes DAX-Measure via add_measure anlegen. Der Ausdruck soll PER TABELLE aggregieren (z.B. SUM(Sales[Quantity]), AVERAGE(Customer[CreditLimit])) – KEINE cross-table-Aggregation, denn wir legen KEINE Beziehungen an. displayFolder: "Measures".\n` +
        `3. KEINE add_relationship-Aufrufe! Das HTML-Dashboard rendert seine Werte direkt über die Measure-Strings, nicht über Modell-Joins. Beziehungen wären nur Fehlerquellen.\n` +
        `4. verify_model NUR mit expectedMeasures aufrufen (Beziehungen sind irrelevant).\n` +
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
      // Aktuellen Stand bevorzugen, falls schon mal designed wurde
      const html = state.fullPageHtml ?? buildFullPageReport(state.project);
      // Initial-HTML in den Helper schreiben, damit AI und Frontend ab
      // sofort denselben State sehen
      if (state.pbipPath) {
        try {
          await helper.saveDesignHtml(state.pbipPath, html);
        } catch {
          /* helper offline – DesignPanel pusht später erneut */
        }
      }
      setState((s) => ({
        ...s,
        phase: "design",
        fullPageHtml: html,
      }));
      // KI explizit über den Phasenwechsel informieren – sonst weiß sie nichts davon
      chat.seedAssistant(
        `Datenmodellierung ist abgeschlossen. Ich bin jetzt in **Phase 2: Design**.\n\n` +
          `Der Bericht „${state.project.name}" hat bereits ein Initial-HTML (page-fillendes Design mit Header, KPI-Karten, Bar-Chart, Top-Tabelle). ` +
          `Ich kann das jetzt für dich anpassen – sag mir einfach was du willst (Farben, Layout, KPIs auf andere Werte mappen, …).\n\n` +
          `Tools die ich in dieser Phase nutze: get_full_page_html (aktuellen Stand lesen), update_full_page_html (deine Änderung im Live-Preview anzeigen), embed_full_page_html (in den PBI-Bericht einbetten).`
      );
    } finally {
      setBusy(false);
    }
  };

  const setFullPageHtml = (html: string) =>
    setState((s) => ({ ...s, fullPageHtml: html }));

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
        {state.phase === "design" && (
          <DesignPanel
            project={state.project}
            pbipPath={state.pbipPath}
            html={state.fullPageHtml ?? buildFullPageReport(state.project)}
            onChange={setFullPageHtml}
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
