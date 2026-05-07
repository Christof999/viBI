import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { helper } from "../lib/helperClient";
import { sanitizeFileName } from "../lib/storage";
import type { CIConfig, HelperStatus, ProjectConfig, ReportType } from "../types";

interface Props {
  onFinish: (project: ProjectConfig) => void;
}

const DEFAULT_CI: CIConfig = {
  colors: {
    primary: "#0078D4",
    secondary: "#1F2937",
    accent: "#F2C811",
    background: "#FFFFFF",
    text: "#111827",
  },
  fontFamily: "Segoe UI, system-ui, sans-serif",
};

const STEPS = [
  "Willkommen",
  "Helper",
  "Berichtstyp",
  "Name",
  "Ziel",
  "Corporate Identity",
  "KPIs",
  "Zusammenfassung",
] as const;

export function Onboarding({ onFinish }: Props) {
  const [step, setStep] = useState(0);
  const [reportType, setReportType] = useState<ReportType>("report");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [ci, setCI] = useState<CIConfig>(DEFAULT_CI);
  const [kpiInput, setKpiInput] = useState("");
  const [kpis, setKpis] = useState<string[]>([]);

  const fileName = useMemo(() => sanitizeFileName(name), [name]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = () => {
    onFinish({
      name: name.trim() || "MyReport",
      fileName,
      reportType,
      goal: goal.trim(),
      ci,
      kpis,
      createdAt: new Date().toISOString(),
    });
  };

  const canAdvance =
    (step === 0) ||
    (step === 1) ||
    (step === 2) ||
    (step === 3 && name.trim().length >= 2) ||
    (step === 4 && goal.trim().length >= 5) ||
    (step === 5) ||
    (step === 6) ||
    (step === 7);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(circle at 20% 0%, rgba(242,200,17,0.10), transparent 60%), var(--bg)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{
          width: "min(900px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 30px 80px rgba(0,0,0,.45)",
        }}
      >
        <Stepper step={step} />

        <div style={{ minHeight: 360, marginTop: 24 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {step === 0 && <WelcomeStep />}
              {step === 1 && <HelperStep />}
              {step === 2 && (
                <ReportTypeStep value={reportType} onChange={setReportType} />
              )}
              {step === 3 && (
                <NameStep value={name} fileName={fileName} onChange={setName} />
              )}
              {step === 4 && <GoalStep value={goal} onChange={setGoal} />}
              {step === 5 && <CIStep value={ci} onChange={setCI} />}
              {step === 6 && (
                <KPIStep
                  kpis={kpis}
                  input={kpiInput}
                  setInput={setKpiInput}
                  onAdd={() => {
                    if (kpiInput.trim()) {
                      setKpis([...kpis, kpiInput.trim()]);
                      setKpiInput("");
                    }
                  }}
                  onRemove={(i) => setKpis(kpis.filter((_, idx) => idx !== i))}
                />
              )}
              {step === 7 && (
                <SummaryStep
                  name={name}
                  fileName={fileName}
                  reportType={reportType}
                  goal={goal}
                  ci={ci}
                  kpis={kpis}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 24,
            borderTop: "1px solid var(--border)",
            paddingTop: 16,
          }}
        >
          <button onClick={back} disabled={step === 0}>
            ← Zurück
          </button>
          {step < STEPS.length - 1 ? (
            <button className="primary" onClick={next} disabled={!canAdvance}>
              Weiter →
            </button>
          ) : (
            <button className="primary" onClick={finish}>
              Bericht erstellen & PowerBI öffnen ✨
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {STEPS.map((label, i) => (
        <div key={label} style={{ flex: 1 }}>
          <motion.div
            initial={false}
            animate={{
              background:
                i <= step ? "var(--accent)" : "var(--border)",
            }}
            style={{ height: 4, borderRadius: 2 }}
          />
          <div
            style={{
              fontSize: 10,
              color: i === step ? "var(--accent)" : "var(--muted)",
              marginTop: 6,
              textAlign: "center",
              fontWeight: i === step ? 700 : 400,
            }}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      {sub && (
        <p style={{ color: "var(--muted)", marginTop: 6, fontSize: 14 }}>{sub}</p>
      )}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div>
      <StepHeader title="Willkommen bei viBI 👋" sub="Dein KI-Co-Designer für PowerBI-Berichte." />
      <ul style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.8, paddingLeft: 18 }}>
        <li>Wir richten in wenigen Schritten dein Bericht-Projekt ein</li>
        <li>Du gibst Name, Ziel, Corporate Identity und KPIs an</li>
        <li>viBI erzeugt das PBIP-Projekt und öffnet PowerBI Desktop</li>
        <li>Anschließend hilft dir der Chat beim Datenmodell</li>
        <li>Danach: HTML-Visual-Design mit Live-Preview und Copy-zum-Einfügen</li>
      </ul>
    </div>
  );
}

function HelperStep() {
  const [status, setStatus] = useState<HelperStatus | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await helper.status();
      if (!stop) setStatus(s);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const ok = status?.ok === true;
  const helperUrl =
    (import.meta.env.VITE_HELPER_URL as string | undefined) ??
    "http://localhost:7321";

  return (
    <div>
      <StepHeader
        title="Helper installieren"
        sub="Der lokale Helper darf PowerBI Desktop starten und Dateien speichern. Aus Browser-Sandbox-Gründen muss er einmalig auf deinem PC laufen."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div
          style={{
            padding: 16,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Schritt 1 · Download
          </div>
          <a
            href={`${helperUrl}/download/setup.ps1`}
            download="vibi-helper-setup.ps1"
            style={{ textDecoration: "none" }}
          >
            <button className="primary" style={{ width: "100%" }}>
              Helper-Setup herunterladen
            </button>
          </a>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            Alternativ manuell:{" "}
            <code style={{ background: "#000", padding: "2px 4px", borderRadius: 4 }}>
              git clone … && npm --prefix helper install && npm --prefix helper start
            </code>
          </div>
        </div>

        <div
          style={{
            padding: 16,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Schritt 2 · Status
          </div>
          <motion.div
            animate={{ scale: ok ? [1, 1.1, 1] : 1 }}
            transition={{ duration: 1.6, repeat: ok ? Infinity : 0 }}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: ok ? "var(--ok)" : "var(--danger)",
              display: "inline-block",
              marginRight: 8,
            }}
          />
          <span style={{ fontSize: 14 }}>
            {ok ? "Helper läuft" : "Helper noch nicht erreichbar"}
          </span>
          {status?.powerBIDesktopFound !== undefined && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              PowerBI Desktop:{" "}
              {status.powerBIDesktopFound ? "✓ gefunden" : "× nicht gefunden"}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            Polling alle 2s · {helperUrl}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
        Du kannst auch ohne laufenden Helper fortfahren – PBIP-Speichern und
        PowerBI-Start funktionieren dann erst, sobald er gestartet ist.
      </div>
    </div>
  );
}

function ReportTypeStep({
  value,
  onChange,
}: {
  value: ReportType;
  onChange: (v: ReportType) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Welche Art Bericht?"
        sub="Du kannst später jederzeit zwischen Designs wechseln."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <TypeCard
          active={value === "report"}
          onClick={() => onChange("report")}
          title="Power BI Report"
          desc="Interaktiver Bericht (PBIP/.pbix) – Standard. Wird in Power BI Desktop geöffnet."
          tag="empfohlen"
        />
        <TypeCard
          disabled
          active={false}
          title="Paginated Report"
          desc=".rdl in Power BI Report Builder. Pixelgenau druckbar."
          tag="bald verfügbar"
        />
      </div>
    </div>
  );
}

function TypeCard({
  active,
  disabled,
  onClick,
  title,
  desc,
  tag,
}: {
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title: string;
  desc: string;
  tag: string;
}) {
  return (
    <motion.div
      whileHover={disabled ? {} : { y: -2 }}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: 16,
        border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: "var(--panel-2)",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <span
          style={{
            fontSize: 10,
            background: active ? "var(--accent)" : "var(--border)",
            color: active ? "#1a1500" : "var(--muted)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {tag}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{desc}</div>
    </motion.div>
  );
}

function NameStep({
  value,
  fileName,
  onChange,
}: {
  value: string;
  fileName: string;
  onChange: (s: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Wie soll der Bericht heißen?"
        sub="Der Name wird auch als Dateiname verwendet."
      />
      <input
        autoFocus
        placeholder="z. B. Vertriebsbericht 2026"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        Dateiname: <code>{fileName}.pbip</code>
      </div>
    </div>
  );
}

function GoalStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Was ist das Ziel?"
        sub="Beschreibe in 1-3 Sätzen, was der Bericht beantworten soll. Das hilft der KI später beim Datenmodell und Design."
      />
      <textarea
        autoFocus
        rows={5}
        placeholder="z. B. ‚Wöchentliche Verkaufsperformance pro Region für die Geschäftsleitung – Fokus auf Zielerreichung und Trends.'"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ resize: "vertical" }}
      />
    </div>
  );
}

function CIStep({
  value,
  onChange,
}: {
  value: CIConfig;
  onChange: (v: CIConfig) => void;
}) {
  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () =>
      onChange({ ...value, logoDataUrl: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const setColor = (k: keyof CIConfig["colors"], v: string) =>
    onChange({ ...value, colors: { ...value.colors, [k]: v } });

  return (
    <div>
      <StepHeader title="Corporate Identity" sub="Logo, Farben und Schriftart deines Berichts." />
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Logo</div>
          <label
            style={{
              border: "1px dashed var(--border)",
              borderRadius: 12,
              padding: 16,
              textAlign: "center",
              cursor: "pointer",
              minHeight: 140,
              display: "grid",
              placeItems: "center",
              background: value.colors.background,
            }}
          >
            {value.logoDataUrl ? (
              <img
                src={value.logoDataUrl}
                alt="Logo"
                style={{ maxWidth: "100%", maxHeight: 100 }}
              />
            ) : (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Logo wählen…</span>
            )}
            <input type="file" accept="image/*" onChange={onLogo} hidden />
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(
            [
              ["primary", "Primär"],
              ["secondary", "Sekundär"],
              ["accent", "Akzent"],
              ["background", "Hintergrund"],
              ["text", "Text"],
            ] as const
          ).map(([k, label]) => (
            <div
              key={k}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", width: 100 }}>{label}</div>
              <input
                type="color"
                value={value.colors[k]}
                onChange={(e) => setColor(k, e.target.value)}
                style={{ width: 44, height: 32, padding: 0, border: "1px solid var(--border)" }}
              />
              <input
                value={value.colors[k]}
                onChange={(e) => setColor(k, e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", width: 100 }}>Schriftart</div>
            <select
              value={value.fontFamily}
              onChange={(e) => onChange({ ...value, fontFamily: e.target.value })}
              style={{
                flex: 1,
                background: "var(--panel-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <option value="Segoe UI, system-ui, sans-serif">Segoe UI</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="'Helvetica Neue', Helvetica, sans-serif">Helvetica</option>
              <option value="Inter, system-ui, sans-serif">Inter</option>
              <option value="Roboto, system-ui, sans-serif">Roboto</option>
              <option value="Georgia, serif">Georgia</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPIStep({
  kpis,
  input,
  setInput,
  onAdd,
  onRemove,
}: {
  kpis: string[];
  input: string;
  setInput: (s: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Welche KPIs hast du im Kopf?"
        sub="Liste die wichtigsten Kennzahlen auf – wir generieren später passende HTML-Visuals dafür."
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          autoFocus
          placeholder="z. B. Umsatz, Conversion Rate, Marge…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <button className="primary" onClick={onAdd}>
          + Hinzufügen
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <AnimatePresence>
          {kpis.map((k, i) => (
            <motion.div
              key={k + i}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "6px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              {k}
              <button
                onClick={() => onRemove(i)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 14,
                }}
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {kpis.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Noch keine KPIs.</div>
        )}
      </div>
    </div>
  );
}

function SummaryStep({
  name,
  fileName,
  reportType,
  goal,
  ci,
  kpis,
}: {
  name: string;
  fileName: string;
  reportType: ReportType;
  goal: string;
  ci: CIConfig;
  kpis: string[];
}) {
  return (
    <div>
      <StepHeader
        title="Bereit?"
        sub="Wenn du auf Erstellen klickst, baut viBI das PBIP-Projekt und versucht PowerBI Desktop zu öffnen."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
        <Item label="Name" value={name || "—"} />
        <Item label="Datei" value={`${fileName}.pbip`} />
        <Item label="Typ" value={reportType === "report" ? "Power BI Report" : "Paginated"} />
        <Item label="KPIs" value={kpis.length ? kpis.join(", ") : "—"} />
        <Item label="Ziel" value={goal || "—"} wide />
        <div style={{ gridColumn: "1/-1", marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>CI-Vorschau</div>
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: ci.colors.background,
              color: ci.colors.text,
              fontFamily: ci.fontFamily,
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            {ci.logoDataUrl && (
              <img src={ci.logoDataUrl} alt="Logo" style={{ height: 40 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{name || "Bericht"}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <Swatch c={ci.colors.primary} />
                <Swatch c={ci.colors.secondary} />
                <Swatch c={ci.colors.accent} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      style={{
        gridColumn: wide ? "1/-1" : undefined,
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Swatch({ c }: { c: string }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        background: c,
        border: "1px solid rgba(0,0,0,.2)",
      }}
    />
  );
}
