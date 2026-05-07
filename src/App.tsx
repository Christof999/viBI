import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { DesignPanel } from "./components/DesignPanel";
import { Header } from "./components/Header";
import { ModelingPanel } from "./components/ModelingPanel";
import { Onboarding } from "./components/Onboarding";
import { useChat } from "./hooks/useChat";
import { helper } from "./lib/helperClient";
import { makeStarterSnippets } from "./lib/snippets";
import { loadState, resetState, saveState } from "./lib/storage";
import type { AppState, HelperStatus, HtmlSnippet, MCPTool, ProjectConfig } from "./types";

const DEFAULT_TARGET_DIR =
  (import.meta.env.VITE_DEFAULT_PBIP_DIR as string | undefined) ??
  "C:\\PowerBI\\viBI";

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [busy, setBusy] = useState(false);
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
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const onOnboardingFinish = async (project: ProjectConfig) => {
    setBusy(true);
    setState((s) => ({ ...s, project }));
    try {
      const { path } = await helper.createProject(project, DEFAULT_TARGET_DIR);
      setState((s) => ({ ...s, project, pbipPath: path, phase: "modeling" }));
      try {
        await helper.openPowerBIDesktop(path);
      } catch {
        /* user can open manually */
      }
    } catch (e) {
      alert(
        `Projekt konnte nicht erstellt werden: ${(e as Error).message}\n\n` +
          "Läuft der Helper? Phase wird trotzdem gesetzt – du kannst es später erneut versuchen."
      );
      setState((s) => ({ ...s, project, phase: "modeling" }));
    } finally {
      setBusy(false);
    }
  };

  const onFinishModeling = async () => {
    if (!state.project) return;
    setBusy(true);
    try {
      // Try to read metadata back from the PBIP folder
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
      const starters = makeStarterSnippets(state.project.kpis);
      setState((s) => ({ ...s, phase: "design", snippets: starters }));
    } finally {
      setBusy(false);
    }
  };

  const addSnippet = (s: HtmlSnippet) =>
    setState((st) => ({ ...st, snippets: [...st.snippets, s] }));
  const updateSnippet = (s: HtmlSnippet) =>
    setState((st) => ({
      ...st,
      snippets: st.snippets.map((x) => (x.id === s.id ? s : x)),
    }));
  const removeSnippet = (id: string) =>
    setState((st) => ({ ...st, snippets: st.snippets.filter((x) => x.id !== id) }));

  const restart = () => {
    if (!confirm("Onboarding zurücksetzen und alle lokal gespeicherten Daten löschen?")) return;
    resetState();
    location.reload();
  };

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
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {state.phase === "modeling" && (
          <ModelingPanel
            project={state.project}
            pbipPath={state.pbipPath}
            onFinishModeling={onFinishModeling}
            busy={busy}
          />
        )}
        {state.phase === "design" && (
          <DesignPanel
            ci={state.project.ci}
            snippets={state.snippets}
            onAdd={addSnippet}
            onUpdate={updateSnippet}
            onRemove={removeSnippet}
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
