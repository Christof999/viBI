// Built-in tools that the helper itself implements (no MCP server needed).
// Advertised under server="helper" via /mcp/tools so the chat can call them
// even when no Fabric/Custom MCP is connected.

import { existsSync } from "node:fs";
import { applyFullPageHTML, readMetadata } from "./pbip.js";
import { loadLibrary, locateProject } from "./library.js";
import { mcpRegistry } from "./mcp.js";

export interface BuiltInTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export const builtInTools: BuiltInTool[] = [
  {
    name: "read_pbip_metadata",
    description:
      "Liest Tabellen, Spalten und Datentypen aus dem aktuell offenen PBIP-Bericht (Power BI Project). Verwende dies, um zu sehen, welche Tabellen der Nutzer bereits in Power BI geladen hat. Wenn pbipPath nicht angegeben wird, nimm den im System-Prompt genannten aktuellen Bericht-Pfad.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: {
          type: "string",
          description: "Vollständiger Pfad zur .pbip-Datei (z.B. C:/PowerBI/viBI/Bericht/Bericht.pbip).",
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich – nutze den Pfad aus dem System-Prompt.");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);
      return readMetadata(path);
    },
  },
  {
    name: "locate_pbip",
    description:
      "Sucht den vollständigen Pfad eines bekannten PBIP-Berichts in der viBI-Bibliothek. Nützlich wenn der User einen Bericht beim Namen nennt.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Bericht-Name oder Teil davon." },
        id: { type: "string", description: "Bibliotheks-ID, falls bekannt." },
      },
    },
    async handler(args) {
      const id = str(args.id);
      if (id) return locateProject(id);
      const name = str(args.name);
      const lib = loadLibrary();
      const matches = name
        ? lib.projects.filter(
            (p) => p.name.toLowerCase().includes(name.toLowerCase()) ||
              p.fileName.toLowerCase().includes(name.toLowerCase())
          )
        : lib.projects;
      return { matches };
    },
  },
  {
    name: "apply_full_page_html",
    description:
      "Schreibt ein vollständiges HTML-Dokument als ein einziges page-fillendes HTML-Visual in die report.json des PBIP-Berichts. Verwende dies, um vom User gewünschte HTML-Anpassungen direkt in den Bericht einzubetten.",
    inputSchema: {
      type: "object",
      required: ["pbipPath", "html"],
      properties: {
        pbipPath: { type: "string" },
        html: {
          type: "string",
          description: "Komplettes HTML-Dokument (mit <html>, <head>, <body> und Inline-Styles).",
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      const html = str(args.html);
      if (!path || !html) throw new Error("pbipPath und html erforderlich");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);
      const out = applyFullPageHTML(path, html);
      return { ok: true, path: out };
    },
  },
  {
    name: "run_fabric_modeling",
    description:
      "Stößt automatische Datenmodellierung über den Microsoft-Fabric-MCP an (Beziehungen, Measures, Datumstabelle). Nur verfügbar, wenn der Fabric-MCP-Server im Helper konfiguriert ist.",
    inputSchema: {
      type: "object",
      required: ["goal", "tables"],
      properties: {
        goal: { type: "string", description: "Berichts-Ziel/Beschreibung." },
        kpis: { type: "array", items: { type: "string" } },
        tables: { type: "array", items: { type: "string" }, description: "Geladene Tabellennamen." },
        pbipPath: { type: "string" },
      },
    },
    async handler(args) {
      if (!mcpRegistry.isConnected("fabric")) {
        return {
          ok: false,
          error: "Fabric-MCP nicht verbunden",
          hint: "FABRIC_MCP_COMMAND/FABRIC_MCP_ARGS im Helper-Env setzen.",
        };
      }
      const all = await mcpRegistry.listTools();
      const candidates = all
        .filter((t) => t.server === "fabric")
        .filter((t) =>
          /model|relationship|measure|date|time|semantic/i.test(
            t.name + " " + (t.description ?? "")
          )
        );
      if (candidates.length === 0) {
        return { ok: false, error: "Keine passenden Fabric-Tools gefunden" };
      }
      const log: { tool: string; ok: boolean; result?: unknown; error?: string }[] = [];
      for (const t of candidates.slice(0, 4)) {
        try {
          const result = await mcpRegistry.callTool("fabric", t.name, args);
          log.push({ tool: t.name, ok: true, result });
        } catch (e) {
          log.push({ tool: t.name, ok: false, error: (e as Error).message });
        }
      }
      return { ok: log.some((l) => l.ok), log };
    },
  },
];

export function asToolDescriptors() {
  return builtInTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    server: "helper" as const,
  }));
}
