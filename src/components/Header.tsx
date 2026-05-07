import { motion } from "framer-motion";
import type { HelperStatus, Phase, ProjectConfig } from "../types";

interface Props {
  status: HelperStatus | null;
  toolCount?: number;
  onRefresh: () => void;
  project?: ProjectConfig;
  phase: Phase;
  onRestart: () => void;
  onLibrary?: () => void;
}

const PHASE_LABEL: Record<Phase, string> = {
  onboarding: "Setup",
  library: "Bibliothek",
  modeling: "Datenmodell",
  design: "Design",
};

export function Header({ status, toolCount, onRefresh, project, phase, onRestart, onLibrary }: Props) {
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
        <StatusPill
          label={`KI-Tools${toolCount !== undefined ? ` · ${toolCount}` : ""}`}
          ok={ok && (toolCount ?? 0) > 0}
          dim={!ok}
        />
        <StatusPill
          label="Fabric MCP"
          ok={!!status?.mcp?.fabric}
          dim={!ok}
          optional
        />
        <StatusPill
          label="Custom MCP"
          ok={!!status?.mcp?.custom}
          dim={!ok}
          optional
        />
        <button onClick={onRefresh}>↻</button>
        {onLibrary && phase !== "library" && (
          <button onClick={onLibrary}>Bibliothek</button>
        )}
        <button onClick={onRestart}>Reset</button>
      </div>
    </motion.header>
  );
}

function PhaseDots({ phase }: { phase: Phase }) {
  const order: Phase[] = ["onboarding", "modeling", "design"];
  // 'library' is orthogonal to the linear flow – treat it as before-modeling
  const effective: Phase = phase === "library" ? "onboarding" : phase;
  const idx = order.indexOf(effective);
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
  optional,
}: {
  label: string;
  ok: boolean;
  dim?: boolean;
  optional?: boolean;
}) {
  // Optionale Pills (Fabric/Custom MCP) zeigen ihren "nicht verbunden"-Zustand
  // grau statt rot, damit klar wird: nicht erforderlich, nur add-on.
  const dotColor = ok
    ? "var(--ok)"
    : optional
    ? "var(--border)"
    : "var(--danger)";
  return (
    <div
      title={
        optional && !ok
          ? "Optional. Nicht erforderlich für den Standard-Workflow."
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: dim ? "var(--muted)" : "var(--text)",
        opacity: dim ? 0.6 : optional && !ok ? 0.7 : 1,
      }}
    >
      <motion.span
        animate={{ scale: ok ? [1, 1.25, 1] : 1 }}
        transition={{ duration: 1.6, repeat: ok ? Infinity : 0 }}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}
