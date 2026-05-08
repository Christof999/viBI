// Built-in tools that the helper itself implements (no MCP server needed).
// Advertised under server="helper" via /mcp/tools so the chat can call them
// even when no Fabric/Custom MCP is connected.

import { existsSync } from "node:fs";
import { applyFullPageHTML, readMetadata } from "./pbip.js";
import { loadLibrary, locateProject } from "./library.js";
import { mcpRegistry } from "./mcp.js";
import {
  addDateTable,
  addMeasure,
  addRelationship,
  listModel,
  removeRelationship,
} from "./tmdl.js";
import { looksLikeViBIPlaceholder, readLiveModel } from "./live-model.js";
import { bestPbipFor, findRecentPbips } from "./pbip-discovery.js";

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
      "Liest Tabellen, Spalten und Datentypen aus dem PBIP-Bericht des Users. Sucht automatisch in den Standard-Speicherorten (Documents, OneDrive, Desktop, C:/PowerBI), wenn der direkte Pfad leer/Platzhalter zurückgibt. Verwendet zuerst den Power-BI-Desktop-Live-Workspace, fällt dann auf TMDL-Dateien zurück.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: {
          type: "string",
          description: "Optional: vollständiger Pfad zur .pbip-Datei.",
        },
        projectName: {
          type: "string",
          description: "Optional: Bericht-Name als Hint für die Auto-Discovery.",
        },
      },
    },
    async handler(args) {
      const explicit = str(args.pbipPath);
      const projectName = str(args.projectName);

      // 1) Live-Workspace ist immer der beste Truthwert (egal ob gespeichert).
      const live = readLiveModel();
      if (live.source === "live-workspace" && live.tables.length > 0) {
        return {
          source: "live-workspace",
          workspacePath: live.workspacePath,
          tables: live.tables.map((t) => ({
            name: t.name,
            columns: t.columns,
            measureCount: t.measures.length,
          })),
          relationshipCount: live.relationships.length,
        };
      }

      // 2) Den explizit gegebenen Pfad probieren – wenn der Real-Daten liefert, gut.
      const tryPath = (p: string): { ok: boolean; tables: { name: string }[]; payload: Record<string, unknown> } => {
        if (!existsSync(p)) return { ok: false, tables: [], payload: { error: "Pfad existiert nicht: " + p } };
        const meta = readMetadata(p);
        const isPlaceholder = looksLikeViBIPlaceholder(meta.tables);
        const ok = meta.tables.length > 0 && !isPlaceholder;
        return {
          ok,
          tables: meta.tables,
          payload: { pbipPath: p, source: "tmdl", layout: meta.layout, ...meta, isPlaceholder },
        };
      };

      const tried: string[] = [];
      if (explicit) {
        tried.push(explicit);
        const r = tryPath(explicit);
        if (r.ok) return r.payload;
      }

      // 3) Auto-Discovery: alle .pbip aus den letzten 14 Tagen unter Documents/OneDrive/Desktop/C:\PowerBI
      const candidates = findRecentPbips({ nameContains: projectName });
      const ordered = projectName ? [bestPbipFor(projectName), ...candidates].filter(Boolean) : candidates;
      for (const c of ordered) {
        if (!c) continue;
        if (tried.includes(c.path)) continue;
        tried.push(c.path);
        const r = tryPath(c.path);
        if (r.ok) {
          return {
            ...r.payload,
            note:
              "Pfad automatisch gefunden via Auto-Discovery (Documents/OneDrive/Desktop). Falls das nicht der gewünschte Bericht ist, gib pbipPath explizit an.",
          };
        }
      }

      // 4) Nichts gefunden → klare Fehlermeldung
      const candidatesList = candidates.slice(0, 8).map((c) => `${c.path} (${new Date(c.mtimeMs).toLocaleString("de-DE")})`);
      return {
        source: "none",
        triedPaths: tried,
        candidatesFound: candidatesList,
        message:
          candidatesList.length === 0
            ? "Keine .pbip-Dateien in den letzten 14 Tagen unter Documents, OneDrive, Desktop oder C:/PowerBI gefunden. Stelle sicher, dass Power BI Desktop läuft und der Bericht gespeichert ist (Strg+S), oder gib pbipPath explizit an."
            : "Nur Platzhalter oder leere Modelle gefunden. Mögliche Kandidaten siehe candidatesFound – bitte User fragen, welcher der richtige Pfad ist.",
      };
    },
  },
  {
    name: "find_pbips",
    description:
      "Listet alle .pbip-Dateien aus den letzten 14 Tagen, die unter Documents, OneDrive, Desktop oder C:/PowerBI liegen. Nützlich, wenn unklar ist, wo der User seinen Bericht gespeichert hat.",
    inputSchema: {
      type: "object",
      properties: {
        nameContains: {
          type: "string",
          description: "Optional: nur Berichte, deren Datei-Name diesen Substring enthält (case insensitive).",
        },
      },
    },
    async handler(args) {
      const list = findRecentPbips({ nameContains: str(args.nameContains) });
      return {
        count: list.length,
        pbips: list.map((p) => ({
          path: p.path,
          name: p.name,
          lastModified: new Date(p.mtimeMs).toISOString(),
        })),
      };
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
    name: "list_model",
    description:
      "Liest die komplette TMDL-Modellstruktur des PBIP-Berichts: alle Tabellen mit Spalten und Measures, sowie alle Beziehungen. Verwende dies, um den aktuellen Stand des Datenmodells zu verstehen, BEVOR du Änderungen machst.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: { type: "string" },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);
      const live = readLiveModel();
      if (live.source === "live-workspace" && live.tables.length > 0) {
        return {
          pbipPath: path,
          source: "live-workspace",
          workspacePath: live.workspacePath,
          tables: live.tables,
          relationships: live.relationships,
          note:
            "Quelle: PBI Desktop Live-Workspace (Model.bim). Schreib-Tools (add_measure, add_relationship, add_date_table) wirken jedoch auf die TMDL des PBIP – diese Änderungen werden in PBI Desktop erst nach Datei→Schließen ohne Speichern + erneut Öffnen sichtbar.",
        };
      }
      const tmdl = listModel(path);
      const placeholder = looksLikeViBIPlaceholder(tmdl.tables);
      return {
        ...tmdl,
        source: "tmdl",
        ...(placeholder
          ? {
              placeholderWarning:
                "Diese TMDL enthält nur den viBI-Platzhalter. Stoppe sofort und sage dem User, dass er den .pbip in Power BI Desktop öffnen, Tabellen laden UND speichern (Strg+S) muss. Erfinde KEINE Modellstruktur.",
            }
          : {}),
      };
    },
  },
  {
    name: "add_measure",
    description:
      "Fügt ein DAX-Measure zu einer existierenden Tabelle im PBIP-Modell hinzu. Schreibt direkt in die model.tmdl. Der User muss in Power BI Desktop danach das Projekt neu öffnen, damit die Änderung sichtbar wird.",
    inputSchema: {
      type: "object",
      required: ["table", "name", "expression"],
      properties: {
        pbipPath: { type: "string" },
        table: { type: "string", description: "Name der Tabelle, in die das Measure soll." },
        name: { type: "string", description: "Anzeigename des Measures." },
        expression: {
          type: "string",
          description:
            'DAX-Ausdruck OHNE führendes "=" (z.B. "SUM(Sales[Amount])" oder mehrzeilig).',
        },
        formatString: {
          type: "string",
          description: 'Optional, z.B. "$#,##0.00" oder "0.0%".',
        },
        displayFolder: { type: "string" },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const table = str(args.table);
      const name = str(args.name);
      const expression = str(args.expression);
      if (!table || !name || !expression) {
        throw new Error("table, name und expression sind Pflicht");
      }
      const r = addMeasure(path, {
        table,
        name,
        expression,
        formatString: str(args.formatString),
        displayFolder: str(args.displayFolder),
      });
      return {
        ...r,
        reloadHint:
          "Power BI Desktop: Datei → Schließen ohne Speichern → erneut öffnen, oder Desktop neu starten, damit die Änderung geladen wird.",
      };
    },
  },
  {
    name: "add_relationship",
    description:
      "Erstellt eine Beziehung zwischen zwei Tabellen im PBIP-Modell. Standardmäßig single-direction many-to-one (active=true). Schreibt direkt in model.tmdl.",
    inputSchema: {
      type: "object",
      required: ["fromTable", "fromColumn", "toTable", "toColumn"],
      properties: {
        pbipPath: { type: "string" },
        fromTable: { type: "string", description: "Many-Seite (Faktentabelle)." },
        fromColumn: { type: "string" },
        toTable: { type: "string", description: "One-Seite (Dimension)." },
        toColumn: { type: "string" },
        crossFilteringBehavior: {
          type: "string",
          enum: ["automatic", "bothDirections", "oneDirection"],
        },
        isActive: { type: "boolean" },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const fromTable = str(args.fromTable);
      const fromColumn = str(args.fromColumn);
      const toTable = str(args.toTable);
      const toColumn = str(args.toColumn);
      if (!fromTable || !fromColumn || !toTable || !toColumn) {
        throw new Error("fromTable, fromColumn, toTable und toColumn sind Pflicht");
      }
      const r = addRelationship(path, {
        fromTable,
        fromColumn,
        toTable,
        toColumn,
        crossFilteringBehavior: args.crossFilteringBehavior as
          | "automatic"
          | "bothDirections"
          | "oneDirection"
          | undefined,
        isActive: typeof args.isActive === "boolean" ? args.isActive : undefined,
      });
      return { ...r, reloadHint: "PBI Desktop schließen ohne Speichern, dann erneut öffnen." };
    },
  },
  {
    name: "remove_relationship",
    description: "Entfernt eine Beziehung anhand ihrer ID (siehe list_model).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        pbipPath: { type: "string" },
        id: { type: "string" },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      const id = str(args.id);
      if (!path || !id) throw new Error("pbipPath und id erforderlich");
      return removeRelationship(path, id);
    },
  },
  {
    name: "add_date_table",
    description:
      "Fügt dem Modell eine kalkulierte Datumstabelle hinzu (CALENDAR + Year/Quarter/Month/MonthName/YearMonth). Wenn schon eine Tabelle mit diesem Namen existiert, passiert nichts.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: { type: "string" },
        name: { type: "string", description: 'Default "Date".' },
        startDate: {
          type: "string",
          description: 'DAX-Ausdruck, default "DATE(2020,1,1)".',
        },
        endDate: {
          type: "string",
          description: 'DAX-Ausdruck, default "DATE(2030,12,31)".',
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const r = addDateTable(path, {
        name: str(args.name),
        startDate: str(args.startDate),
        endDate: str(args.endDate),
      });
      return {
        ...r,
        reloadHint:
          "Nach dem Reload in PBI Desktop: Beziehung der Faktentabelle (Datums-Spalte) auf Date.Date anlegen lassen via add_relationship.",
      };
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
