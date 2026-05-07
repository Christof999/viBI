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
      `- read_pbip_metadata({pbipPath}): liest die geladenen Tabellen + Spalten + Datentypen aus dem PBIP. Wenn der User "verbinde dich mit dem Bericht" oder "schau in den Bericht" sagt, RUFE DIESES TOOL AUF mit dem oben genannten PBIP-Pfad. Behaupte NIEMALS, du könntest dich nicht verbinden, solange das Tool verfügbar ist.\n` +
      `- locate_pbip({name?}): findet PBIP-Pfade in der viBI-Bibliothek.\n` +
      `- apply_full_page_html({pbipPath, html}): schreibt ein vollständiges HTML als single page-fillendes Visual in die report.json.\n` +
      `- run_fabric_modeling({goal, kpis, tables, pbipPath?}): startet automatische Modellierung (nur falls Fabric-MCP verbunden).`;
    chat.setExtraSystemPrompt(ctx);
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
    setBusy(true);
    setState((s) => ({ ...s, suggestion, modelingStep: "working" }));
    chat.seedAssistant(
      `Super – ich rufe jetzt den Microsoft-Fabric-MCP auf, der Beziehungen, Measures und eine Datumstabelle für deinen Bericht „${state.project.name}" anlegt. Tabellen: ${suggestion.tables
        .map((t) => t.name)
        .join(", ")}`
    );
    try {
      const r = await helper.runModeling({
        goal: state.project.goal,
        kpis: state.project.kpis,
        tables: suggestion.tables,
        pbipPath: state.pbipPath,
      });
      if (r.ok) {
        chat.seedAssistant(
          `Modellierung abgeschlossen. ` +
            (r.log ?? [])
              .filter((l) => l.ok)
              .map((l) => `✓ ${l.tool}`)
              .join(" · ")
        );
      } else {
        chat.seedAssistant(
          `Fabric-MCP konnte nicht automatisch modellieren (${
            r.error ?? "unbekannter Fehler"
          })${r.hint ? "\n\n" + r.hint : ""}\n\nDu kannst trotzdem direkt mit mir per Chat weiterarbeiten – ich helfe dir bei DAX, Beziehungen und Measures Schritt für Schritt.`
        );
      }
    } catch (e) {
      chat.seedAssistant(`Modellierung-Aufruf fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
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
