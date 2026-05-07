import { motion } from "framer-motion";
import type { PBIPProject } from "../types";

interface Props {
  project: PBIPProject;
}

export function ReportCanvas({ project }: Props) {
  const table = project.tables[0];
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
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <Card title="Umsatz gesamt" value="27.752,60 €" delta="+12,4 %" />
        <Card title="Aktive Regionen" value={String(uniqueCount(table?.rows ?? [], "Region"))} delta="3 / 3" />
        <Card title="Letzter Datensatz" value={lastDate(table?.rows ?? [])} delta="heute" wide />

        <motion.section
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          style={{
            gridColumn: "1 / -1",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
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
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Tabelle: {table?.name ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Vorschau · max 10 Zeilen
            </div>
          </div>

          {table ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th
                        key={c.name}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          color: "var(--muted)",
                          borderBottom: "1px solid var(--border)",
                          fontWeight: 500,
                        }}
                      >
                        {c.name}
                        <span style={{ fontSize: 10, marginLeft: 6, color: "#5a6172" }}>
                          {c.dataType}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(table.rows ?? []).slice(0, 10).map((row, i) => (
                    <motion.tr
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.04 }}
                    >
                      {table.columns.map((c) => (
                        <td
                          key={c.name}
                          style={{
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {String(row[c.name] ?? "")}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: "var(--muted)" }}>Keine Tabellen.</div>
          )}
        </motion.section>
      </motion.div>
    </main>
  );
}

function Card({
  title,
  value,
  delta,
  wide,
}: {
  title: string;
  value: string;
  delta: string;
  wide?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      style={{
        gridColumn: wide ? "1 / -1" : undefined,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ok)", marginTop: 4 }}>{delta}</div>
    </motion.div>
  );
}

function uniqueCount(rows: Record<string, unknown>[], key: string) {
  return new Set(rows.map((r) => r[key])).size;
}

function lastDate(rows: Record<string, unknown>[]) {
  const last = rows[rows.length - 1];
  return last ? String(last["Date"] ?? "—") : "—";
}
