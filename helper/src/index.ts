import cors from "cors";
import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { mcpRegistry } from "./mcp.js";
import { applyFullPageHTML, readMetadata, writePBIP } from "./pbip.js";
import {
  libraryPath,
  loadLibrary,
  locateProject,
  removeCIPreset,
  removeProject,
  setProjectPath,
  upsertCIPreset,
  upsertProject,
} from "./library.js";

const PORT = Number(process.env.PORT ?? 7321);
const CORS_ORIGIN =
  process.env.CORS_ORIGIN ?? "http://localhost:5173,https://*.vercel.app";

const PBI_DESKTOP_CANDIDATES = [
  "C:/Program Files/Microsoft Power BI Desktop/bin/PBIDesktop.exe",
  "C:/Program Files (x86)/Microsoft Power BI Desktop/bin/PBIDesktop.exe",
];
const PBI_DESKTOP_PATH = process.env.POWERBI_DESKTOP_PATH;

function findPowerBIDesktop(): string | null {
  if (PBI_DESKTOP_PATH && existsSync(PBI_DESKTOP_PATH)) return PBI_DESKTOP_PATH;
  for (const p of PBI_DESKTOP_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

const allowedOrigins = CORS_ORIGIN.split(",").map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const ok = allowedOrigins.some((pat) => {
        if (pat === origin) return true;
        if (pat.includes("*")) {
          const re = new RegExp(
            "^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
          );
          return re.test(origin);
        }
        return false;
      });
      cb(ok ? null : new Error(`CORS blocked: ${origin}`), ok);
    },
  })
);

app.get("/status", (_req, res) => {
  res.json({
    ok: true,
    version: "0.2.0",
    powerBIDesktopFound: !!findPowerBIDesktop(),
    mcp: {
      fabric: mcpRegistry.isConnected("fabric"),
      custom: mcpRegistry.isConnected("custom"),
    },
  });
});

app.post("/powerbi/open", (req, res) => {
  const exe = findPowerBIDesktop();
  if (!exe) {
    res.status(404).json({
      ok: false,
      error:
        "PowerBI Desktop nicht gefunden. POWERBI_DESKTOP_PATH als Env setzen oder PowerBI Desktop installieren.",
    });
    return;
  }
  const filePath = (req.body?.filePath as string | undefined) ?? undefined;
  const args = filePath ? [filePath] : [];
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.unref();
  res.json({ ok: true });
});

app.post("/powerbi/close", (_req, res) => {
  if (process.platform !== "win32") {
    res.json({ ok: false, error: "Nur unter Windows verfügbar" });
    return;
  }
  exec("taskkill /IM PBIDesktop.exe /F", (err, stdout, stderr) => {
    if (err && !/not found/i.test(stderr)) {
      res.status(500).json({ ok: false, error: stderr || err.message });
      return;
    }
    res.json({ ok: true, output: stdout || stderr });
  });
});

app.post("/project/create", (req, res) => {
  try {
    const { project, targetDir } = req.body ?? {};
    if (!project || !targetDir) {
      res.status(400).json({ ok: false, error: "project und targetDir erforderlich" });
      return;
    }
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const projectDir = join(targetDir, project.fileName ?? project.name);
    const path = writePBIP(projectDir, project);
    const entry = upsertProject({
      name: project.name,
      fileName: project.fileName ?? project.name,
      pbipPath: path,
      goal: project.goal ?? "",
      ci: project.ci,
      kpis: project.kpis ?? [],
    });
    res.json({ ok: true, path, libraryId: entry.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// --- Library --------------------------------------------------------------

app.get("/library", (_req, res) => {
  res.json({ ...loadLibrary(), file: libraryPath() });
});

app.post("/library/projects/:id/locate", (req, res) => {
  res.json(locateProject(req.params.id));
});

app.post("/library/projects/:id/path", (req, res) => {
  const { pbipPath } = req.body ?? {};
  if (typeof pbipPath !== "string" || !pbipPath) {
    res.status(400).json({ ok: false, error: "pbipPath erforderlich" });
    return;
  }
  if (!existsSync(pbipPath)) {
    res.status(404).json({ ok: false, error: "Datei existiert nicht" });
    return;
  }
  const updated = setProjectPath(req.params.id, pbipPath);
  if (!updated) {
    res.status(404).json({ ok: false, error: "Projekt nicht gefunden" });
    return;
  }
  res.json({ ok: true, project: updated });
});

app.delete("/library/projects/:id", (req, res) => {
  const ok = removeProject(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.post("/library/ci-presets", (req, res) => {
  const { name, ci, id } = req.body ?? {};
  if (typeof name !== "string" || !ci) {
    res.status(400).json({ ok: false, error: "name und ci erforderlich" });
    return;
  }
  res.json({ ok: true, preset: upsertCIPreset(name, ci, id) });
});

app.delete("/library/ci-presets/:id", (req, res) => {
  const ok = removeCIPreset(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.post("/report/apply-html", (req, res) => {
  try {
    const { pbipPath, html } = req.body ?? {};
    if (typeof pbipPath !== "string" || typeof html !== "string") {
      res.status(400).json({ ok: false, error: "pbipPath und html erforderlich" });
      return;
    }
    if (!existsSync(pbipPath)) {
      res.status(404).json({ ok: false, error: "PBIP nicht gefunden" });
      return;
    }
    const path = applyFullPageHTML(pbipPath, html);
    res.json({ ok: true, path });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post("/project/metadata", (req, res) => {
  try {
    const { pbipPath } = req.body ?? {};
    if (!pbipPath) {
      res.status(400).json({ error: "pbipPath erforderlich" });
      return;
    }
    res.json(readMetadata(pbipPath));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/modeling/run", async (req, res) => {
  const { goal, kpis, tables, pbipPath } = (req.body ?? {}) as {
    goal?: string;
    kpis?: string[];
    tables?: { name: string; keyColumns?: string[] }[];
    pbipPath?: string;
  };
  if (!goal || !tables?.length) {
    res.status(400).json({ ok: false, error: "goal und tables erforderlich" });
    return;
  }
  if (!mcpRegistry.isConnected("fabric")) {
    res.json({
      ok: false,
      error: "Fabric-MCP nicht verbunden",
      hint:
        "FABRIC_MCP_COMMAND und FABRIC_MCP_ARGS in der Helper-Umgebung setzen, dann Helper neu starten.",
    });
    return;
  }
  try {
    const all = await mcpRegistry.listTools();
    const fabricTools = all.filter((t) => t.server === "fabric");
    // Heuristik: passende Tools für "auto-modellierung" suchen
    const candidates = fabricTools.filter((t) =>
      /model|relationship|measure|date|time|semantic/i.test(t.name + " " + (t.description ?? ""))
    );
    if (candidates.length === 0) {
      res.json({ ok: false, error: "Keine passenden Fabric-Tools gefunden", available: fabricTools.map((t) => t.name) });
      return;
    }
    const log: { tool: string; ok: boolean; result?: unknown; error?: string }[] = [];
    for (const t of candidates.slice(0, 4)) {
      try {
        const result = await mcpRegistry.callTool("fabric", t.name, {
          goal,
          kpis: kpis ?? [],
          tables: tables.map((tab) => tab.name),
          pbipPath: pbipPath ?? null,
        });
        log.push({ tool: t.name, ok: true, result });
      } catch (e) {
        log.push({ tool: t.name, ok: false, error: (e as Error).message });
      }
    }
    res.json({ ok: log.some((l) => l.ok), log });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get("/mcp/tools", async (_req, res) => {
  try {
    res.json(await mcpRegistry.listTools());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/mcp/call", async (req, res) => {
  try {
    const { server, name, args } = req.body ?? {};
    if (!server || !name) {
      res.status(400).json({ error: "server und name erforderlich" });
      return;
    }
    const result = await mcpRegistry.callTool(server, name, args ?? {});
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// File write within whitelisted roots (used for ad-hoc HTML snippet exports etc.)
const ALLOWED_WRITE_ROOTS = (process.env.ALLOWED_WRITE_ROOTS ?? "C:/PowerBI")
  .split(",")
  .map((s) => s.trim().replace(/\\/g, "/"));

app.post("/file/write", (req, res) => {
  const { path: target, contents } = req.body ?? {};
  if (typeof target !== "string" || typeof contents !== "string") {
    res.status(400).json({ ok: false, error: "path und contents erforderlich" });
    return;
  }
  const norm = target.replace(/\\/g, "/");
  if (!ALLOWED_WRITE_ROOTS.some((root) => norm.toLowerCase().startsWith(root.toLowerCase()))) {
    res.status(403).json({
      ok: false,
      error: `Pfad nicht erlaubt. Whitelist: ${ALLOWED_WRITE_ROOTS.join(", ")}`,
    });
    return;
  }
  const dir = norm.substring(0, norm.lastIndexOf("/"));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, contents, "utf8");
  res.json({ ok: true, path: target });
});

// PowerShell setup script the onboarding page links to.
const SETUP_PS1 = `# viBI Helper – Setup
# Lädt Node.js (falls nötig), klont das Repo und startet den Helper auf :7321.
$ErrorActionPreference = "Stop"
$ROOT = "$env:USERPROFILE\\.vibi-helper"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Bitte zuerst Node.js >= 20 installieren: https://nodejs.org/"
  exit 1
}
if (-not (Test-Path $ROOT)) {
  git clone https://github.com/Christof999/viBI.git $ROOT
}
Push-Location "$ROOT/helper"
npm install
npm run build
Start-Process -NoNewWindow node "dist/index.js"
Pop-Location
Write-Host "viBI Helper läuft auf http://localhost:7321"
`;

app.get("/download/setup.ps1", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="vibi-helper-setup.ps1"'
  );
  res.send(SETUP_PS1);
});

mcpRegistry
  .init()
  .catch((e) => console.warn("MCP init warning:", (e as Error).message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`viBI helper läuft auf http://localhost:${PORT}`);
      console.log(`CORS erlaubt: ${allowedOrigins.join(", ")}`);
    });
  });
