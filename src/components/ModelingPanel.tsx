import { motion } from "framer-motion";
import type { ProjectConfig } from "../types";

interface Props {
  project: ProjectConfig;
  pbipPath?: string;
  onFinishModeling: () => void;
  busy?: boolean;
}

export function ModelingPanel({ project, pbipPath, onFinishModeling, busy }: Props) {
  return (
    <main
      style={{
        flex: 1,
        padding: 24,
        overflow: "auto",
        background:
          "radial-gradient(circle at 30% 0%, rgba(242,200,17,0.07), transparent 60%), var(--bg)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 16 }}
      >
        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
            Phase 1 · Datenmodell
          </div>
          <h2 style={{ margin: "8px 0 4px" }}>{project.name}</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{project.goal}</div>
          {pbipPath && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "ui-monospace, Menlo, monospace",
              }}
            >
              📁 {pbipPath}
            </div>
          )}
        </section>

        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>So gehst du jetzt vor</h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 14, color: "var(--text)" }}>
            <li>Power BI Desktop sollte sich gerade geöffnet haben</li>
            <li>
              Importiere deine Datenquellen (CSV, SQL, REST…) – nutze den Chat rechts für DAX,
              Power-Query oder Modellierungs-Hilfe
            </li>
            <li>Definiere Beziehungen, Measures und Hierarchien</li>
            <li>Wenn das Modell steht: <strong>Bericht in PBI Desktop speichern</strong></li>
            <li>
              Klick unten auf „Modell fertig" – viBI liest die Metadaten ein, schließt PBI Desktop
              und führt dich ins Design
            </li>
          </ol>
        </section>

        <section style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => window.location.reload()}>Abbrechen</button>
          <button className="primary" onClick={onFinishModeling} disabled={busy}>
            {busy ? "Speichere & schließe PBI…" : "Modell fertig → zum Design ✨"}
          </button>
        </section>

        <section>
          <h3 style={{ fontSize: 13, color: "var(--muted)", textTransform: "uppercase" }}>
            KPIs auf der Liste
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {project.kpis.map((k) => (
              <span
                key={k}
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 12,
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </section>
      </motion.div>
    </main>
  );
}
