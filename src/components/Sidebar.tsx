import { motion } from "framer-motion";
import type { MCPTool, PBIPProject } from "../types";

interface Props {
  project: PBIPProject;
  tools: MCPTool[];
  onOpenPBI: () => void;
  onSavePBIP: () => void;
  saving: boolean;
}

export function Sidebar({ project, tools, onOpenPBI, onSavePBIP, saving }: Props) {
  return (
    <motion.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
      style={{
        width: 280,
        borderRight: "1px solid var(--border)",
        background: "var(--panel)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto",
      }}
    >
      <Section title="Projekt">
        <div style={{ fontSize: 14, fontWeight: 600 }}>{project.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {project.tables.length} Tabelle(n)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <button className="primary" onClick={onSavePBIP} disabled={saving}>
            {saving ? "Speichere…" : "PBIP lokal speichern"}
          </button>
          <button onClick={onOpenPBI}>PowerBI Desktop öffnen</button>
        </div>
      </Section>

      <Section title="Tabellen">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {project.tables.map((t) => (
            <motion.div
              key={t.name}
              whileHover={{ x: 2 }}
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                padding: 10,
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {t.columns.length} Spalten · {t.rows?.length ?? 0} Zeilen
              </div>
            </motion.div>
          ))}
        </div>
      </Section>

      <Section title={`MCP-Tools (${tools.length})`}>
        {tools.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Keine Tools verfügbar. Helper starten und MCP-Server konfigurieren.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tools.map((t) => (
              <div
                key={`${t.server}:${t.name}`}
                style={{
                  fontSize: 12,
                  padding: "6px 8px",
                  background: "var(--panel-2)",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    color:
                      t.server === "fabric"
                        ? "var(--accent)"
                        : "var(--ok)",
                    marginRight: 6,
                    fontSize: 10,
                    textTransform: "uppercase",
                  }}
                >
                  {t.server}
                </span>
                {t.name}
              </div>
            ))}
          </div>
        )}
      </Section>
    </motion.aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--muted)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
