import cors from "cors";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { mcpRegistry } from "./mcp.js";
import { writePBIP } from "./pbip.js";

const PORT = Number(process.env.PORT ?? 7321);
const CORS_ORIGIN =
  process.env.CORS_ORIGIN ?? "http://localhost:5173,https://*.vercel.app";

const PBI_DESKTOP_CANDIDATES = [
  "C:/Program Files/Microsoft Power BI Desktop/bin/PBIDesktop.exe",
  "C:/Program Files (x86)/Microsoft Power BI Desktop/bin/PBIDesktop.exe",
  // Microsoft Store install path is dynamic; user can override via env.
];
const PBI_DESKTOP_PATH = process.env.POWERBI_DESKTOP_PATH;

function findPowerBIDesktop(): string | null {
  if (PBI_DESKTOP_PATH && existsSync(PBI_DESKTOP_PATH)) return PBI_DESKTOP_PATH;
  for (const p of PBI_DESKTOP_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const app = express();
app.use(express.json({ limit: "5mb" }));

const allowedOrigins = CORS_ORIGIN.split(",").map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const ok = allowedOrigins.some((pat) => {
        if (pat === origin) return true;
        if (pat.includes("*")) {
          const re = new RegExp("^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
          return re.test(origin);
        }
        return false;
      });
      cb(ok ? null : new Error(`CORS blocked: ${origin}`), ok);
    },
  })
);

app.get("/status", async (_req, res) => {
  res.json({
    ok: true,
    version: "0.1.0",
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

app.post("/pbip/save", (req, res) => {
  try {
    const { project, targetDir } = req.body ?? {};
    if (!project || !targetDir) {
      res.status(400).json({ ok: false, error: "project und targetDir erforderlich" });
      return;
    }
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const projectDir = join(targetDir, project.name);
    const path = writePBIP(projectDir, project);
    res.json({ ok: true, path });
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

// Convenience: write an arbitrary file (audit-log + safety: only inside whitelisted dirs)
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

mcpRegistry
  .init()
  .catch((e) => console.warn("MCP init warning:", (e as Error).message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`viBI helper läuft auf http://localhost:${PORT}`);
      console.log(`CORS erlaubt: ${allowedOrigins.join(", ")}`);
    });
  });
