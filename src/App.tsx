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
    const ctx =
      `AKTUELLER BERICHT:\n` +
      `- Name: ${state.project.name}\n` +
      `- Beschreibung/Ziel: ${state.project.goal}\n` +
      `- KPIs: ${state.project.kpis.join(", ") || "—"}\n` +
      (state.pbipPath ? `- PBIP-Pfad: ${state.pbipPath}\n` : "") +
      (state.suggestion
        ? `- Vorgeschlagene Tabellen: ${state.suggestion.tables
            .map((t) => t.name)
            .join(", ")}\n`
        : "") +
      `\nMETA: Alle Niederlassungen nutzen Microsoft Dynamics 365 Business Central als ERP.\n\n` +
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
      `- apply_full_page_html({pbipPath, html}): page-fillendes HTML-Visual in report.json schreiben.\n` +
      `- run_fabric_modeling: nur falls Fabric-MCP verbunden, sonst die obigen Tools verwenden.\n\n` +
      `WICHTIG: Wenn der User „modelliere" oder „verbinde dich mit dem Bericht" sagt, RUFE DIE TOOLS DIREKT AUF. Behaupte NIE, du könntest das nicht. ` +
      `Nach Schreib-Tools (add_*) erwähnst du im Antworttext den reloadHint aus dem Tool-Resultat (PBI Desktop neu öffnen).\n\n` +
      `DATENQUELLEN-LOGIK: Tools liefern in 'source' entweder 'live-workspace' (PBI Desktop hat den Bericht aktuell offen) oder 'tmdl' (gelesen aus der Datei). ` +
      `Wenn read_pbip_metadata 'source' = 'none' liefert oder isPlaceholder=true zurückgibt: rufe SOFORT find_pbips auf (mit nameContains=Projektname), schau in das Ergebnis und wähle den .pbip mit dem passenden Namen. Erst wenn auch find_pbips leer ist, sage dem User, dass er Strg+S in PBI Desktop drücken soll. ` +
      `Erfinde NIE Tabellen, die nicht in einem Tool-Resultat 'tables' stehen.\n\n` +
      `MODELLIERUNGS-REIHENFOLGE (verbindlich):\n` +
      `1. Zuerst IMMER list_model aufrufen, um den aktuellen Stand zu sehen (Tabellen, Spalten, Measures, BESTEHENDE BEZIEHUNGEN).\n` +
      `2. Beziehungen NICHT doppelt anlegen. Wenn list_model schon eine Beziehung zwischen zwei Spalten zeigt, NIE add_relationship dafür aufrufen. Bei add_relationship gibt es zwar einen alreadyExisted-Schutz, aber rufe das Tool gar nicht erst auf, wenn die Beziehung schon da ist – das spart Schritte.\n` +
      `3. add_date_table NUR wenn list_model keine Tabelle namens 'Date' enthält. Frische viBI-Projekte haben bereits eine Datumstabelle.\n` +
      `4. Schritte planen: 1 list_model, dann ggf. 1 add_date_table, dann pro Faktentabelle EINE add_relationship zur Date-Tabelle, dann pro KPI EIN add_measure. Nicht mehr.\n` +
      `5. AM ENDE IMMER eine kurze deutsche Textantwort schicken: Was wurde angelegt, was war schon da, welche Reload-Hinweise gelten. Kein Kommentar = User denkt du bist hängengeblieben.`;
    chat.setExtraSystemPrompt(ctx);
    chat.setToolArgDefaults({
      pbipPath: state.pbipPath,
      goal: state.project.goal,
      kpis: state.project.kpis,
      tables: state.suggestion?.tables.map((t) => t.name),
    });
  }, [state.project, state.suggestion, state.pbipPath]);

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
      const html = buildFullPageReport(state.project);
      setState((s) => ({
        ...s,
        phase: "design",
        fullPageHtml: html,
      }));
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
