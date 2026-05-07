import { motion } from "framer-motion";
import type { HelperStatus } from "../types";

interface Props {
  status: HelperStatus | null;
  onRefresh: () => void;
}

export function Header({ status, onRefresh }: Props) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          <div style={{ fontSize: 16, fontWeight: 700 }}>viBI</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            AI PowerBI Designer
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <StatusPill label="Helper" ok={ok} />
        <StatusPill
          label="MS Fabric MCP"
          ok={!!status?.mcp?.fabric}
          dim={!ok}
        />
        <StatusPill
          label="Custom MCP"
          ok={!!status?.mcp?.custom}
          dim={!ok}
        />
        <button onClick={onRefresh}>Status aktualisieren</button>
      </div>
    </motion.header>
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
