import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { suggestTables } from "../lib/api";
import type { ProjectConfig, SuggestedTable, TableSuggestion } from "../types";

interface Props {
  project: ProjectConfig;
  initial?: TableSuggestion;
  onAccept: (suggestion: TableSuggestion) => void;
  onRequestDifferent: (suggestion: TableSuggestion) => void;
}

export function TableProposal({ project, initial, onAccept, onRequestDifferent }: Props) {
  const [suggestion, setSuggestion] = useState<TableSuggestion | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestion = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await suggestTables({
        description: project.goal,
        reportName: project.name,
        kpis: project.kpis,
      });
      setSuggestion(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initial) fetchSuggestion();
  }, []);

  return (
    <main
      style={{
        flex: 1,
        padding: 32,
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
        <section>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
            Phase 1 · Datenmodell · Tabellen-Vorschlag
          </div>
          <h2 style={{ margin: "8px 0 4px" }}>{project.name}</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Anforderung: <em>{project.goal}</em>
          </div>
        </section>

        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              Vorgeschlagene Quelltabellen aus Business Central
            </h3>
            <button onClick={fetchSuggestion} disabled={loading} style={{ fontSize: 12 }}>
              {loading ? "Lade…" : "Neu vorschlagen"}
            </button>
          </div>

          {loading && (
            <div style={{ marginTop: 16, color: "var(--muted)", fontSize: 13 }}>
              <Spinner /> KI analysiert deine Anforderung …
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: "rgba(220,80,80,.12)",
                border: "1px solid rgba(220,80,80,.4)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {suggestion && !loading && (
            <>
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--text)" }}>
                {suggestion.rationale}
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <AnimatePresence>
                  {suggestion.tables.map((t, i) => (
                    <TableCard key={t.name + i} table={t} index={i} />
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}
        </section>

        {suggestion && !loading && (
          <section
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button onClick={() => onRequestDifferent(suggestion)}>
              Ich möchte andere Tabellen
            </button>
            <button className="primary" onClick={() => onAccept(suggestion)}>
              Tabellen geladen → KI modelliert
            </button>
          </section>
        )}

        <section
          style={{
            fontSize: 12,
            color: "var(--muted)",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <strong style={{ color: "var(--text)" }}>So gehst du vor:</strong> Lade die oben gelisteten
          Tabellen in Power BI Desktop (Daten abrufen → Business Central / OData / Fabric Mirror).
          Sobald alle Tabellen importiert <em>und der Bericht gespeichert</em> ist, klick auf
          „Tabellen geladen". viBI ruft den Microsoft-Fabric-MCP auf, der Beziehungen, Measures und
          Datumstabelle automatisch passend zu deiner Anforderung anlegt.
        </section>
      </motion.div>
    </main>
  );
}

function TableCard({ table, index }: { table: SuggestedTable; index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ delay: index * 0.05 }}
      style={{
        padding: 12,
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>{table.name}</div>
        <span
          style={{
            fontSize: 10,
            color: "var(--muted)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {table.source}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{table.purpose}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {table.keyColumns.map((c) => (
          <span
            key={c}
            style={{
              fontSize: 11,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function Spinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        border: "2px solid var(--accent)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}
