import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { Header } from "./components/Header";
import { ReportCanvas } from "./components/ReportCanvas";
import { Sidebar } from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import { helper } from "./lib/helperClient";
import { emptyProject } from "./lib/pbip";
import type { HelperStatus, MCPTool } from "./types";

const DEFAULT_TARGET_DIR =
  (import.meta.env.VITE_DEFAULT_PBIP_DIR as string | undefined) ??
  "C:\\PowerBI\\viBI";

export default function App() {
  const [project, _setProject] = useState(() => emptyProject("Sales Demo"));
  void _setProject;
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [saving, setSaving] = useState(false);
  const chat = useChat(tools);

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
  }, [refresh]);

  const onSavePBIP = async () => {
    setSaving(true);
    try {
      const { path } = await helper.savePBIP(project, DEFAULT_TARGET_DIR);
      alert(`PBIP gespeichert unter:\n${path}`);
    } catch (e) {
      alert(`Fehler beim Speichern: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onOpenPBI = async () => {
    try {
      await helper.openPowerBIDesktop();
    } catch (e) {
      alert(`PowerBI Desktop konnte nicht geöffnet werden: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header status={status} onRefresh={refresh} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar
          project={project}
          tools={tools}
          onOpenPBI={onOpenPBI}
          onSavePBIP={onSavePBIP}
          saving={saving}
        />
        <ReportCanvas project={project} />
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
