import { motion } from "framer-motion";
import type { DesignMode, ProjectConfig } from "../types";

interface Props {
  project: ProjectConfig;
  onSelect: (mode: DesignMode) => void;
}

export function DesignModeChoice({ project, onSelect }: Props) {
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
        style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 18 }}
      >
        <section>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
            Phase 2 · Designweg auswählen
          </div>
          <h2 style={{ margin: "8px 0 4px" }}>{project.name}</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Wähle, ob viBI ein gestaltetes HTML-Dashboard oder native PowerBI-Visuals erzeugen soll.
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", gap: 16 }}>
          <ChoiceCard
            title="Über HTML erstellen"
            badge="Maximale Gestaltungsfreiheit"
            onClick={() => onSelect("html")}
            bullets={[
              "Ein page-fillendes HTML-Content-Visual mit Live-Vorschau.",
              "Die KI nutzt einen Interface-Design-Leitfaden gegen generische Dashboard-Layouts.",
              "KPI-Werte bleiben dynamisch über {{Measure}}-Platzhalter.",
            ]}
          />
          <ChoiceCard
            title="PowerBI Visuals"
            badge="Native Berichtselemente"
            onClick={() => onSelect("powerbi")}
            bullets={[
              "Filter werden als Slicer in den Bericht geschrieben.",
              "Beziehungen zwischen passenden Tabellen werden im Modell angelegt/verifiziert.",
              "Karten, Diagramm und Tabelle werden direkt an Measures und Spalten gebunden.",
            ]}
          />
        </div>

        <section
          style={{
            color: "var(--muted)",
            fontSize: 12,
            lineHeight: 1.6,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
          }}
        >
          HTML ist ideal, wenn das Dashboard stark gestaltet sein soll. PowerBI Visuals sind besser,
          wenn Anwender mit nativen Slicern, Cross-Filtering und Standard-Visuals arbeiten sollen.
        </section>
      </motion.div>
    </main>
  );
}

function ChoiceCard({
  title,
  badge,
  bullets,
  onClick,
}: {
  title: string;
  badge: string;
  bullets: string[];
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ y: 0 }}
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        color: "var(--text)",
        cursor: "pointer",
        minHeight: 260,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          padding: "4px 9px",
          borderRadius: 999,
          background: "rgba(242,200,17,0.12)",
          color: "var(--accent)",
          fontSize: 11,
          fontWeight: 700,
          marginBottom: 14,
        }}
      >
        {badge}
      </div>
      <h3 style={{ margin: "0 0 10px", fontSize: 20 }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", fontSize: 13, lineHeight: 1.7 }}>
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <div style={{ marginTop: 18, color: "var(--accent)", fontSize: 13, fontWeight: 700 }}>
        Diesen Weg nutzen →
      </div>
    </motion.button>
  );
}
