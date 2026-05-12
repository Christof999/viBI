import { motion } from "framer-motion";
import { useState } from "react";
import { helper } from "../lib/helperClient";
import type { ProjectConfig, TableSuggestion } from "../types";

interface Props {
  project: ProjectConfig;
  pbipPath?: string;
  suggestion?: TableSuggestion;
}

export function PowerBIVisualPanel({ project, pbipPath, suggestion }: Props) {
  const [opening, setOpening] = useState(false);
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<{
    kind: "ok" | "err";
    text: string;
    details?: string[];
  } | null>(null);

  const openInPBI = async () => {
    if (!pbipPath) return;
    setOpening(true);
    setOpenMsg(null);
    try {
      await helper.openPowerBIDesktop(pbipPath);
      setOpenMsg("Power BI Desktop wurde geöffnet. Nach KI-Änderungen bitte schließen und erneut öffnen.");
    } catch (e) {
      setOpenMsg(`Konnte PBI Desktop nicht öffnen: ${(e as Error).message}`);
    } finally {
      setOpening(false);
    }
  };

  const createVisuals = async () => {
    if (!pbipPath) return;
    setGenerating(true);
    setGenerateMsg(null);
    try {
      const { result } = await helper.callMCPTool("helper", "create_powerbi_report_visuals", {
        pbipPath,
        title: project.name,
        subtitle: project.goal,
      });
      const payload = result as {
        summary?: string;
        reportJsonPath?: string;
        reloadHint?: string;
        visuals?: {
          slicers?: unknown[];
          cards?: unknown[];
          barChart?: unknown;
          table?: unknown;
        };
      };
      const details = [
        payload.reportJsonPath ? `report.json: ${payload.reportJsonPath}` : null,
        payload.visuals?.slicers ? `Slicer: ${payload.visuals.slicers.length}` : null,
        payload.visuals?.cards ? `KPI-Karten: ${payload.visuals.cards.length}` : null,
        payload.visuals?.barChart ? "Balkendiagramm: erstellt" : null,
        payload.visuals?.table ? "Tabelle: erstellt" : null,
        payload.reloadHint ?? "PBI Desktop schließen ohne Speichern, dann erneut öffnen.",
      ].filter(Boolean) as string[];
      setGenerateMsg({
        kind: "ok",
        text: payload.summary ?? "Native PowerBI-Visuals wurden erstellt.",
        details,
      });
    } catch (e) {
      setGenerateMsg({
        kind: "err",
        text: `Visuals konnten nicht erstellt werden: ${(e as Error).message}`,
      });
    } finally {
      setGenerating(false);
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
        style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}
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
            Phase 2 · Native PowerBI Visuals
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
              {pbipPath}
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
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Was viBI jetzt im Bericht anlegt</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: 10 }}>
            <Feature title="Slicer statt Filterbereich" text="Datums-, Perioden- oder Dimensionsfilter werden als sichtbare Slicer platziert." />
            <Feature title="Beziehungen im Modell" text="Die KI liest das Modell, legt fehlende Beziehungen an und verifiziert sie." />
            <Feature title="Gebundene Visuals" text="Karten, Balkendiagramm und Tabelle werden an echte Measures und Spalten gebunden." />
            <Feature title="Reload-Hinweis" text="Nach TMDL-/report.json-Änderungen muss Power BI Desktop neu geöffnet werden." />
          </div>
        </section>

        {suggestion && (
          <section
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 14,
              fontSize: 12,
            }}
          >
            <strong>Tabellen aus der Modellierungsphase:</strong>{" "}
            {suggestion.tables.map((table) => table.name).join(", ")}
          </section>
        )}

        <section style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button onClick={openInPBI} disabled={!pbipPath || opening}>
            {opening ? "Öffne…" : "In PBI Desktop öffnen"}
          </button>
          <button className="primary" onClick={createVisuals} disabled={!pbipPath || generating}>
            {generating ? "Erstelle Visuals…" : "Native Visuals direkt erstellen"}
          </button>
        </section>

        {generateMsg && (
          <section
            style={{
              background: generateMsg.kind === "err" ? "rgba(220,80,80,.12)" : "rgba(80,200,120,.12)",
              border:
                generateMsg.kind === "err"
                  ? "1px solid rgba(220,80,80,.35)"
                  : "1px solid rgba(80,200,120,.35)",
              borderRadius: 10,
              padding: 12,
              fontSize: 12,
              color: generateMsg.kind === "err" ? "var(--danger)" : "var(--ok)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: generateMsg.details?.length ? 6 : 0 }}>
              {generateMsg.text}
            </div>
            {generateMsg.details && generateMsg.details.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {generateMsg.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {openMsg && (
          <div
            style={{
              fontSize: 12,
              color: openMsg.startsWith("Konnte") ? "var(--danger)" : "var(--ok)",
            }}
          >
            {openMsg}
          </div>
        )}
      </motion.div>
    </main>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}
