import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
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
  const [status, setStatus] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const lastPushedRef = useRef<string>("");

  // 1) Beim Mount: schauen, ob der Helper schon ein gespeichertes HTML hat
  //    (z.B. weil die KI vorher update_full_page_html aufgerufen hat).
  //    Falls ja, dem Frontend übernehmen.
  useEffect(() => {
    if (!pbipPath) return;
    let cancelled = false;
    helper
      .getDesignHtml(pbipPath)
      .then((r) => {
        if (cancelled) return;
        if (r.exists && r.html && r.html !== html) {
          onChange(r.html);
          lastPushedRef.current = r.html;
        } else {
          // erstmaliger Eintritt: aktuellen Frontend-State an den Helper pushen
          helper.saveDesignHtml(pbipPath, html).catch(() => {});
          lastPushedRef.current = html;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // intentional: nur einmal beim ersten Mount für diesen pbipPath
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbipPath]);

  // 2) Frontend-Änderungen (User tippt im Editor) → debounced an Helper pushen
  useEffect(() => {
    if (!pbipPath) return;
    if (html === lastPushedRef.current) return;
    const t = setTimeout(() => {
      helper
        .saveDesignHtml(pbipPath, html)
        .then(() => {
          lastPushedRef.current = html;
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [html, pbipPath]);

  // 3) KI-Änderungen → poll alle 1.5s, falls der Helper neueres HTML hat
  useEffect(() => {
    if (!pbipPath) return;
    const id = setInterval(async () => {
      try {
        const r = await helper.getDesignHtml(pbipPath);
        if (r.exists && r.html && r.html !== lastPushedRef.current && r.html !== html) {
          onChange(r.html);
          lastPushedRef.current = r.html;
          setStatus({ kind: "ok", text: "🤖 KI hat das HTML aktualisiert" });
          setTimeout(() => setStatus(null), 2500);
        }
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => clearInterval(id);
  }, [pbipPath, html, onChange]);

  const copy = async () => {
    await navigator.clipboard.writeText(inlineForHtmlVisual(html));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const [instructions, setInstructions] = useState<string[] | null>(null);

  const apply = async () => {
    if (!pbipPath) {
      setStatus({ kind: "err", text: "Kein PBIP-Pfad bekannt – Bericht zuerst speichern." });
      return;
    }
    setApplying(true);
    setStatus(null);
    setInstructions(null);
    try {
      const r = await helper.applyFullPageHTML({ pbipPath, html });
      if (r.measurePath) {
        const measureBit = r.replaced
          ? `↻ Measure '${r.measureName}' auf Tabelle '${r.table}' aktualisiert`
          : `✓ Measure '${r.measureName}' auf Tabelle '${r.table}' angelegt`;
        const visualBit = r.visualPlaced
          ? "· Visual auf Seite 1 platziert (HTML Content, Measure gebunden)"
          : "";
        setStatus({ kind: "ok", text: `${measureBit} ${visualBit}`.trim() });
        setInstructions(r.userInstructions ?? null);
      } else if (r.error) {
        setStatus({ kind: "err", text: `⚠ ${r.error}` });
      } else {
        setStatus({ kind: "warn", text: "Embed-Antwort ohne Measure-Pfad." });
      }
    } catch (e) {
      setStatus({ kind: "err", text: (e as Error).message });
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

      {status && (
        <div
          style={{
            padding: "8px 20px",
            background:
              status.kind === "err"
                ? "rgba(220,80,80,.12)"
                : status.kind === "warn"
                ? "rgba(220,180,80,.12)"
                : "rgba(80,200,120,.12)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color:
              status.kind === "err"
                ? "var(--danger)"
                : status.kind === "warn"
                ? "var(--accent)"
                : "var(--ok)",
            wordBreak: "break-word",
          }}
        >
          {status.text}
        </div>
      )}

      {instructions && instructions.length > 0 && (
        <div
          style={{
            padding: "12px 20px",
            background: "var(--panel-2)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>So bekommst du das HTML in den Bericht:</div>
          <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            {instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div style={{ marginTop: 8, color: "var(--muted)" }}>
            Visual:{" "}
            <a
              href="https://html-content.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              html-content.com
            </a>
          </div>
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
