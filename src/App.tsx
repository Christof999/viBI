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
          `Du bist NICHT mehr in der Modellierung. KEINE add_measure / add_relationship / add_*-TMDL-Tools mehr aufrufen, außer der User fragt explizit nach DAX/Beziehungen. ` +
          `Stattdessen: das Layout der Berichtsseite ist ein einzelnes vollständiges HTML-Dokument, das page-filling als HTML-Visual eingebettet wird. Es lebt im Helper als .vibi-design.html.\n\n` +
          `Workflow für JEDE Design-Anpassung:\n` +
          `1. ZUERST get_full_page_html({pbipPath}) aufrufen – das ist der aktuelle Stand. NIEMALS aus dem Gedächtnis HTML neu generieren – die existierende Vorlage hat schon Header, KPI-Karten, Bar-Chart, Top-Tabelle, Footer mit CI-Farben.\n` +
          `2. DAS BESTEHENDE HTML als Basis nehmen, gezielt modifizieren (User-Wunsch umsetzen, alles andere lassen).\n` +
          `3. update_full_page_html({pbipPath, html: <das komplette neue Dokument>}) – die Live-Preview im DesignPanel aktualisiert sich automatisch.\n` +
          `4. Erst wenn der User explizit „in den Bericht einbetten" sagt: embed_full_page_html aufrufen.\n` +
          `5. Antworte dem User KURZ in Bullets: was hast du geändert, wie sieht es aus.\n\n` +
          `WICHTIG: Niemals halben Schnipsel zurückliefern. Das HTML muss IMMER ein vollständiges Dokument mit <html><head><style>...</style></head><body>...</body></html> sein. Inline-CSS bevorzugen. Keine externen Bilder, keine externen Fonts (außer Web-Safe Stack), keine fetch-Aufrufe. Das Visual läuft im sandboxed iframe ohne Netz.\n\n`
        : "") +
      `VERFÜGBARE TOOLS (server="helper"):\n` +
      `- read_pbip_metadata({pbipPath}): kurze Tabellen-/Spalten-Übersicht.\n` +
      `- list_model({pbipPath}): vollständiger TMDL-Zustand inkl. Measures und Beziehungen.\n` +
      `- add_measure({pbipPath, table, name, expression, formatString?, displayFolder?}): DAX-Measure anlegen.\n` +
      `- add_relationship({pbipPath, fromTable, fromColumn, toTable, toColumn, crossFilteringBehavior?, isActive?}): Beziehung anlegen (from = Many-Seite/Faktentabelle, to = One-Seite/Dimension).\n` +
      `- remove_relationship({pbipPath, id}): Beziehung löschen.\n` +
      `- add_date_table({pbipPath, name?, startDate?, endDate?}): kalkulierte Datumstabelle (Date + Year/Quarter/Month/MonthName/YearMonth) anlegen.\n` +
      `- add_calculated_table({pbipPath, name, expression, dataCategory?}): eine beliebige neue kalkulierte Tabelle anlegen (z.B. CALENDAR(...), SUMMARIZE(...), DISTINCT(...)). Ausdruck single-line.\n` +
      `- add_calculated_column({pbipPath, table, name, expression, dataType?, formatString?, summarizeBy?}): einer Tabelle eine berechnete Spalte hinzufügen (single-line DAX).\n` +
      `- locate_pbip({name?}): Bibliotheks-Suche.\n` +
      `- get_full_page_html({pbipPath}): aktuelles Design-HTML lesen (Design-Phase).\n` +
      `- update_full_page_html({pbipPath, html}): Design-HTML aktualisieren (Design-Phase, Live-Preview).\n` +
      `- embed_full_page_html({pbipPath, html?}): in report.json + StaticResources einbetten.\n` +
      `- apply_full_page_html({pbipPath, html}): Alias zu embed_full_page_html.\n` +
      `- run_fabric_modeling: nur falls Fabric-MCP verbunden, sonst die obigen Tools verwenden.\n\n` +
      `WICHTIG: Wenn der User „modelliere" oder „verbinde dich mit dem Bericht" sagt, RUFE DIE TOOLS DIREKT AUF. Behaupte NIE, du könntest das nicht. ` +
      `Nach Schreib-Tools (add_*) erwähnst du im Antworttext den reloadHint aus dem Tool-Resultat (PBI Desktop neu öffnen).\n\n` +
      `DATENQUELLEN-LOGIK: Tools liefern in 'source' entweder 'live-workspace' (PBI Desktop hat den Bericht aktuell offen) oder 'tmdl' (gelesen aus der Datei). ` +
      `Wenn read_pbip_metadata 'source' = 'none' liefert oder isPlaceholder=true zurückgibt: rufe SOFORT find_pbips auf (mit nameContains=Projektname), schau in das Ergebnis und wähle den .pbip mit dem passenden Namen. Erst wenn auch find_pbips leer ist, sage dem User, dass er Strg+S in PBI Desktop drücken soll. ` +
      `Erfinde NIE Tabellen, die nicht in einem Tool-Resultat 'tables' stehen.\n\n` +
      `MODELLIERUNGS-REIHENFOLGE (verbindlich):\n` +
      `1. Zuerst IMMER list_model aufrufen, um den aktuellen Stand zu sehen (Tabellen, Spalten, Measures, BESTEHENDE BEZIEHUNGEN). Erfinde NIE Spaltennamen – nimm sie 1:1 aus list_model.tables[].columns[].name. Wenn die KI „OrderID" o.ä. annehmen will, prüfe vorher ob eine Spalte exakt so heißt; sonst Tool-Aufruf mit echtem Namen aus dem Modell.\n` +
      `2. Beziehungen NICHT doppelt anlegen. Wenn list_model schon eine Beziehung zwischen zwei Spalten zeigt, NIE add_relationship dafür aufrufen.\n` +
      `3. add_date_table NUR wenn list_model keine Tabelle namens 'Date' enthält. Frische viBI-Projekte haben bereits eine Datumstabelle.\n` +
      `4. Schritte planen: 1 list_model, dann ggf. 1 add_date_table, dann pro Faktentabelle EINE add_relationship zur Date-Tabelle, dann pro KPI EIN add_measure. Nicht mehr.\n` +
      `5. POWER-BI-BEZIEHUNGSREGEL: Pro Tabellenpaar darf nur EINE aktive Beziehung existieren. Wenn z.B. Orders zwei Datumsspalten (OrderDate, ShippedDate) hat, die beide auf Date.Date zeigen sollen, ist NUR die eine die "Aktive"; die andere muss isActive=false sein (in DAX via USERELATIONSHIP nutzbar). add_relationship erkennt das automatisch und legt die zweite als inactive an, ABER: plan trotzdem im Voraus, welche du als Standard-Aktive willst, und übergib für die anderen explizit isActive=false. Ignorierst du das, kriegt PBI Desktop den Fehler PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH und der Bericht öffnet nicht mehr.\n` +
      `6. NACH ALLEN SCHREIB-TOOLS: rufe verify_model auf mit den expectedTables/expectedRelationships/expectedMeasures, die du gerade angelegt hast. Wenn ambiguousPaths nicht leer ist, rufe SOFORT fix_ambiguous_relationships auf – das deaktiviert die zweiten/dritten aktiven Beziehungen automatisch.\n` +
      `7. AM ENDE IMMER eine kurze deutsche Textantwort schicken, die: (a) jeden 'summary'-Satz aus den Tool-Resultaten zusammenfasst (✓/↩︎/⚠️/🚨), (b) das verify_model-Ergebnis erwähnt (X/Y Tabellen ok, etc.), (c) den reloadHint einmal nennt. Format: kurze Bullet-Liste. Kein Kommentar = User denkt du bist hängengeblieben.\n\n` +
      `RECOVERY: Wenn der User berichtet, dass PBI Desktop einen Fehler beim Öffnen wirft (Variation-Pfad nicht gefunden / mehrdeutige Beziehungen / TMDL-Format-Fehler), rufe SOFORT restore_tmdl_backup auf. Das stellt den Stand von vor der letzten viBI-Änderung wieder her. Erkläre dem User danach, was reverted wurde, und frage ob er die Änderung anders versuchen will.`;
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
    // Chat-getriebene Modellierung: KI nutzt list_model, add_relationship,
    // add_measure, add_date_table direkt auf der TMDL.
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
        `2. Falls keine Datumstabelle existiert, add_date_table aufrufen.\n` +
        `3. Sinnvolle Beziehungen via add_relationship anlegen (Faktentabelle → Dimension).\n` +
        `4. Pro KPI ein passendes DAX-Measure via add_measure anlegen (mit formatString und displayFolder "Measures").\n` +
        `5. Am Ende eine kurze deutsche Zusammenfassung, was du angelegt hast und welche Reload-Hinweise gelten.`
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
