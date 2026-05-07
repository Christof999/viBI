import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { helper } from "../lib/helperClient";
import type { CIPreset, Library, LibraryProject } from "../types";

interface Props {
  onOpen: (project: LibraryProject) => void;
  onNew: () => void;
  onClose?: () => void;
  helperOnline: boolean;
}

export function LibraryScreen({ onOpen, onNew, onClose, helperOnline }: Props) {
  const [lib, setLib] = useState<Library>({ projects: [], ciPresets: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!helperOnline) {
      setLoading(false);
      return;
    }
    try {
      setLib(await helper.library());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [helperOnline]);

  const open = async (p: LibraryProject) => {
    setBusyId(p.id);
    setError(null);
    try {
      const found = await helper.locateProject(p.id);
      if (found.ok) {
        const updated = { ...p, pbipPath: found.pbipPath };
        try {
          await helper.openPowerBIDesktop(found.pbipPath);
        } catch {
          /* user can open manually */
        }
        onOpen(updated);
        return;
      }
      // 3rd stage: ask user for path
      const manual = prompt(
        `Bericht „${p.name}" nicht gefunden.\n` +
          `Durchsucht: ${found.searched.join(", ")}\n\n` +
          `Bitte gib den vollständigen Pfad zur .pbip-Datei ein:`
      );
      if (!manual) return;
      const r = await helper.setProjectPath(p.id, manual);
      if (!r.ok || !r.project) {
        setError(r.error ?? "Pfad ungültig");
        return;
      }
      try {
        await helper.openPowerBIDesktop(r.project.pbipPath);
      } catch {
        /* ignore */
      }
      onOpen(r.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: LibraryProject) => {
    if (!confirm(`„${p.name}" aus der Bibliothek entfernen? Die Dateien auf der Festplatte bleiben.`))
      return;
    await helper.removeProject(p.id);
    refresh();
  };

  const removePreset = async (p: CIPreset) => {
    if (!confirm(`CI-Preset „${p.name}" löschen?`)) return;
    await helper.removeCIPreset(p.id);
    refresh();
  };

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
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
              Bibliothek
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 28 }}>Deine Berichte</h1>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Lokal gespeichert in{" "}
              <code>{lib.file ?? "~/.vibi/library.json"}</code>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {onClose && <button onClick={onClose}>← Zurück</button>}
            <button className="primary" onClick={onNew}>
              + Neuer Bericht
            </button>
          </div>
        </div>

        {!helperOnline && (
          <Notice tone="warn">
            Helper ist offline – Bibliothek kann nicht geladen werden.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        {loading ? (
          <div style={{ color: "var(--muted)" }}>Lade…</div>
        ) : lib.projects.length === 0 ? (
          <Empty onNew={onNew} />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            <AnimatePresence>
              {lib.projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  busy={busyId === p.id}
                  onOpen={() => open(p)}
                  onRemove={() => remove(p)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {lib.ciPresets.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>CI-Presets</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {lib.ciPresets.map((p) => (
                <CIPresetCard key={p.id} preset={p} onRemove={() => removePreset(p)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onRemove,
}: {
  project: LibraryProject;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const c = project.ci.colors;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.25 }}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 80,
          background: `linear-gradient(135deg, ${c.primary} 0%, ${c.accent} 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          color: "#fff",
          fontFamily: project.ci.fontFamily,
        }}
      >
        {project.ci.logoDataUrl ? (
          <img
            src={project.ci.logoDataUrl}
            alt=""
            style={{
              maxHeight: 48,
              maxWidth: 100,
              background: "rgba(255,255,255,.85)",
              padding: 4,
              borderRadius: 4,
            }}
          />
        ) : (
          <div style={{ fontWeight: 800, fontSize: 18 }}>{project.name.slice(0, 18)}</div>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <Swatch c={c.primary} />
          <Swatch c={c.secondary} />
          <Swatch c={c.accent} />
        </div>
      </div>
      <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{project.name}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginTop: 4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 32,
          }}
        >
          {project.goal || "Kein Ziel angegeben"}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--muted)",
            marginTop: 8,
            fontFamily: "ui-monospace, Menlo, monospace",
            wordBreak: "break-all",
          }}
        >
          {project.pbipPath}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {project.kpis.length} KPIs · zuletzt geöffnet{" "}
          {new Date(project.lastOpenedAt).toLocaleDateString("de-DE")}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: "auto",
            paddingTop: 12,
            justifyContent: "flex-end",
          }}
        >
          <button onClick={onRemove} style={{ fontSize: 12 }}>
            Entfernen
          </button>
          <button className="primary" onClick={onOpen} disabled={busy}>
            {busy ? "Suche…" : "Öffnen"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function CIPresetCard({ preset, onRemove }: { preset: CIPreset; onRemove: () => void }) {
  const c = preset.ci.colors;
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          height: 32,
          borderRadius: 6,
          background: `linear-gradient(90deg, ${c.primary}, ${c.secondary}, ${c.accent})`,
          marginBottom: 8,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{preset.name}</div>
        <button onClick={onRemove} style={{ fontSize: 11, padding: "2px 8px" }}>
          ×
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
        {preset.ci.fontFamily}
      </div>
    </div>
  );
}

function Swatch({ c }: { c: string }) {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        background: c,
        border: "1px solid rgba(255,255,255,.4)",
      }}
    />
  );
}

function Empty({ onNew }: { onNew: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        textAlign: "center",
        padding: "60px 20px",
        background: "var(--panel)",
        border: "1px dashed var(--border)",
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Noch keine Berichte</div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Erstelle deinen ersten viBI-Bericht.
      </div>
      <button className="primary" onClick={onNew}>
        + Neuer Bericht
      </button>
    </motion.div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warn" | "error";
  children: React.ReactNode;
}) {
  const colors =
    tone === "error"
      ? { bg: "rgba(220,80,80,.12)", border: "rgba(220,80,80,.4)" }
      : { bg: "rgba(242,200,17,.10)", border: "rgba(242,200,17,.4)" };
  return (
    <div
      style={{
        padding: 10,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
