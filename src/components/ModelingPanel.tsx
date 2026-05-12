import { motion } from "framer-motion";
import { useState } from "react";
import { helper } from "../lib/helperClient";
import type { ProjectConfig, TableSuggestion } from "../types";

interface Props {
  project: ProjectConfig;
  pbipPath?: string;
  suggestion?: TableSuggestion;
  onFinishModeling: () => void;
  onBackToProposal: () => void;
  busy?: boolean;
}

export function ModelingPanel({
  project,
  pbipPath,
  suggestion,
  onFinishModeling,
  onBackToProposal,
  busy,
}: Props) {
  const [opening, setOpening] = useState(false);
  const [openMsg, setOpenMsg] = useState<string | null>(null);

  const openInPBI = async () => {
    if (!pbipPath) return;
    setOpening(true);
    setOpenMsg(null);
    try {
      await helper.openPowerBIDesktop(pbipPath);
      setOpenMsg("Power BI Desktop wurde mit deinem .pbip geöffnet. Lade dort deine Tabellen und drücke Strg+S.");
    } catch (e) {
      setOpenMsg(`Konnte PBI Desktop nicht öffnen: ${(e as Error).message}`);
    } finally {
      setOpening(false);
    }
  };
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

        {suggestion && (
          <section
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 20,
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
              <h3 style={{ margin: 0, fontSize: 15 }}>Geladene/akzeptierte Tabellen</h3>
              <button onClick={onBackToProposal} style={{ fontSize: 12 }}>
                ← Zurück zum Vorschlag
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {suggestion.tables.map((t) => (
                <span
                  key={t.name}
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </section>
        )}

        <section
          style={{
            background: "linear-gradient(180deg, rgba(242,200,17,0.10), rgba(242,200,17,0.02))",
            border: "1px solid var(--accent)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
            ⚠️ Wichtig: Deine Tabellen müssen in <em>diesem</em> .pbip landen
          </h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 14, color: "var(--text)" }}>
            <li>
              Klick unten <strong>„In PBI Desktop öffnen"</strong> – das öffnet genau die
              .pbip-Datei oben (kein neues, leeres Fenster verwenden!)
            </li>
            <li>
              In Power BI Desktop: <strong>Daten abrufen → Business Central / OData</strong>{" "}
              und die vorgeschlagenen Tabellen importieren
            </li>
            <li>
              <strong>Strg+S drücken</strong> – das ist der entscheidende Schritt. Erst beim
              Speichern schreibt PBI die Tabellen in die TMDL, sonst sieht viBI nur den
              Platzhalter.
            </li>
            <li>
              Im Chat rechts: „Welche Tabellen sind aktuell geladen?" – viBI liest live aus dem
              PBI-Workspace und legt pro KPI eine passende Measure + Datumstabelle an. Beziehungen
              werden im späteren PowerBI-Visuals-Pfad gezielt ergänzt; HTML-Dashboards kommen ohne
              Modell-Joins aus.
            </li>
            <li>
              Klick „Modell fertig" sobald du zufrieden bist – führt dich ins Design.
            </li>
          </ol>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={openInPBI} disabled={!pbipPath || opening} className="primary">
              {opening ? "Öffne…" : "📂 In PBI Desktop öffnen"}
            </button>
          </div>
          {openMsg && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: openMsg.startsWith("Konnte") ? "var(--danger)" : "var(--ok)",
              }}
            >
              {openMsg}
            </div>
          )}
        </section>

        <section style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onBackToProposal}>Andere Tabellen vorschlagen</button>
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
