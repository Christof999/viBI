import { motion } from "framer-motion";
import type { HelperStatus, Phase, ProjectConfig } from "../types";

interface Props {
  status: HelperStatus | null;
  onRefresh: () => void;
  project?: ProjectConfig;
  phase: Phase;
  onRestart: () => void;
}

const PHASE_LABEL: Record<Phase, string> = {
  onboarding: "Setup",
  modeling: "Datenmodell",
  design: "Design",
};

export function Header({ status, onRefresh, project, phase, onRestart }: Props) {
  const ok = status?.ok === true;
  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <motion.div
          initial={{ scale: 0.8, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background:
              "linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)",
            display: "grid",
            placeItems: "center",
            color: "#1a1500",
            fontWeight: 800,
          }}
        >
          vi
        </motion.div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            viBI{project ? ` · ${project.name}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Phase: {PHASE_LABEL[phase]}
          </div>
        </div>

        <PhaseDots phase={phase} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <StatusPill label="Helper" ok={ok} />
        <StatusPill label="Fabric MCP" ok={!!status?.mcp?.fabric} dim={!ok} />
        <StatusPill label="Custom MCP" ok={!!status?.mcp?.custom} dim={!ok} />
        <button onClick={onRefresh}>↻</button>
        <button onClick={onRestart}>Reset</button>
      </div>
    </motion.header>
  );
}

function PhaseDots({ phase }: { phase: Phase }) {
  const order: Phase[] = ["onboarding", "modeling", "design"];
  const idx = order.indexOf(phase);
  return (
    <div style={{ display: "flex", gap: 6, marginLeft: 16 }}>
      {order.map((p, i) => (
        <motion.div
          key={p}
          animate={{
            background: i <= idx ? "var(--accent)" : "var(--border)",
            scale: i === idx ? 1.15 : 1,
          }}
          style={{ width: 8, height: 8, borderRadius: "50%" }}
        />
      ))}
    </div>
  );
}

function StatusPill({
  label,
  ok,
  dim,
}: {
  label: string;
  ok: boolean;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: dim ? "var(--muted)" : "var(--text)",
        opacity: dim ? 0.6 : 1,
      }}
    >
      <motion.span
        animate={{ scale: ok ? [1, 1.25, 1] : 1 }}
        transition={{ duration: 1.6, repeat: ok ? Infinity : 0 }}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--danger)",
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}
