import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { exportForHtmlVisual } from "../lib/snippets";
import type { CIConfig, HtmlSnippet } from "../types";
import { HtmlPreview } from "./HtmlPreview";

interface Props {
  ci: CIConfig;
  snippets: HtmlSnippet[];
  onAdd: (s: HtmlSnippet) => void;
  onUpdate: (s: HtmlSnippet) => void;
  onRemove: (id: string) => void;
}

export function DesignPanel({ ci, snippets, onAdd, onUpdate, onRemove }: Props) {
  const [activeId, setActiveId] = useState<string | null>(snippets[0]?.id ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const active = snippets.find((s) => s.id === activeId) ?? snippets[0];

  const copy = async (snippet: HtmlSnippet) => {
    const out = exportForHtmlVisual(snippet.html, ci);
    await navigator.clipboard.writeText(out);
    setCopied(snippet.id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Snippet list */}
      <aside
        style={{
          width: 260,
          borderRight: "1px solid var(--border)",
          background: "var(--panel)",
          padding: 12,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>
            Visuals
          </div>
          <button
            onClick={() =>
              onAdd({
                id: Math.random().toString(36).slice(2, 10),
                name: "Neues Visual",
                type: "custom",
                html: '<div style="padding:16px">Neues Visual – HTML hier einfügen.</div>',
              })
            }
            style={{ padding: "4px 8px", fontSize: 12 }}
          >
            +
          </button>
        </div>
        <AnimatePresence>
          {snippets.map((s) => (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveId(s.id)}
              style={{
                cursor: "pointer",
                padding: 10,
                borderRadius: 8,
                marginBottom: 6,
                border: `1px solid ${active?.id === s.id ? "var(--accent)" : "var(--border)"}`,
                background: active?.id === s.id ? "var(--panel-2)" : "transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(s.id);
                  }}
                  style={{ padding: "2px 6px", fontSize: 11, color: "var(--muted)" }}
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  marginTop: 2,
                }}
              >
                {s.type}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {snippets.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Noch keine Snippets.</div>
        )}
      </aside>

      {/* Preview + actions */}
      <main style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {active ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{active.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Live-Preview · CI angewandt · Direkt für PowerBI HTML-Visual exportierbar
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditing((e) => !e)}>
                  {editing ? "Vorschau" : "HTML bearbeiten"}
                </button>
                <button className="primary" onClick={() => copy(active)}>
                  {copied === active.id ? "✓ Kopiert" : "Für HTML-Visual kopieren"}
                </button>
              </div>
            </div>

            {editing ? (
              <textarea
                value={active.html}
                onChange={(e) => onUpdate({ ...active, html: e.target.value })}
                style={{
                  flex: 1,
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 12,
                  resize: "none",
                }}
              />
            ) : (
              <div style={{ flex: 1, minHeight: 0 }}>
                <HtmlPreview html={active.html} ci={ci} />
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "var(--muted)", margin: "auto" }}>Kein Visual ausgewählt.</div>
        )}
      </main>
    </div>
  );
}
