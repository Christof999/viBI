import { motion } from "framer-motion";
import { useState } from "react";
import { helper } from "../lib/helperClient";
import { inlineForHtmlVisual } from "../lib/snippets";
import type { ProjectConfig } from "../types";

interface Props {
  project: ProjectConfig;
  pbipPath?: string;
  html: string;
  onChange: (html: string) => void;
}

type ViewMode = "preview" | "code";

export function DesignPanel({ project, pbipPath, html, onChange }: Props) {
  const [mode, setMode] = useState<ViewMode>("preview");
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(inlineForHtmlVisual(html));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const apply = async () => {
    if (!pbipPath) {
      setError("Kein PBIP-Pfad bekannt – Bericht zuerst speichern.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const r = await helper.applyFullPageHTML({ pbipPath, html });
      setApplied(`In ${r.path} eingebettet`);
      setTimeout(() => setApplied(null), 4000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
            Phase 2 · Design · Ein HTML-Visual über die gesamte Seite
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{project.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              display: "flex",
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <ToggleButton active={mode === "preview"} onClick={() => setMode("preview")}>
              Vorschau
            </ToggleButton>
            <ToggleButton active={mode === "code"} onClick={() => setMode("code")}>
              HTML
            </ToggleButton>
          </div>
          <button onClick={copy}>{copied ? "✓ Kopiert" : "Kopieren"}</button>
          <button className="primary" onClick={apply} disabled={applying || !pbipPath}>
            {applying ? "Wende an…" : "In Bericht einbetten"}
          </button>
        </div>
      </motion.div>

      {(error || applied) && (
        <div
          style={{
            padding: "8px 20px",
            background: error ? "rgba(220,80,80,.12)" : "rgba(80,200,120,.12)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: error ? "var(--danger)" : "var(--ok)",
          }}
        >
          {error ?? applied}
        </div>
      )}

      <div style={{ flex: 1, padding: 16, overflow: "hidden", display: "flex" }}>
        {mode === "preview" ? (
          <iframe
            title="Bericht-Preview"
            sandbox="allow-same-origin"
            srcDoc={html}
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "#fff",
            }}
          />
        ) : (
          <textarea
            value={html}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 12,
              resize: "none",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              background: "#0f1115",
              color: "#e6e6e6",
            }}
          />
        )}
      </div>
    </main>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 10px",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#1a1500" : "var(--text)",
        border: "none",
        borderRadius: 0,
        fontSize: 12,
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  );
}
