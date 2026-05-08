// Built-in tools that the helper itself implements (no MCP server needed).
// Advertised under server="helper" via /mcp/tools so the chat can call them
// even when no Fabric/Custom MCP is connected.

import { existsSync } from "node:fs";
import { applyFullPageHTML, readMetadata } from "./pbip.js";
import { loadLibrary, locateProject } from "./library.js";
import { mcpRegistry } from "./mcp.js";
import {
  addCalculatedColumn,
  addCalculatedTable,
  addDateTable,
  addMeasure,
  addRelationship,
  fixAmbiguousRelationships,
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
        summary: `✓ Measure '${name}' in Tabelle '${table}' angelegt`,
        reloadHint:
          "Power BI Desktop: Datei → Schließen ohne Speichern → erneut öffnen, damit die Änderung geladen wird.",
      };
    },
  },
  {
    name: "add_relationship",
    description:
      "Erstellt eine Beziehung zwischen zwei Tabellen im PBIP-Modell. Standardmäßig single-direction many-to-one (active=true). Idempotent: prüft VOR dem Schreiben, ob die Beziehung schon existiert (in beide Richtungen). Falls ja, wird KEINE neue angelegt – der Tool-Output enthält dann alreadyExisted=true samt vorhandener relationshipId.",
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
      const arrow = `'${fromTable}'.'${fromColumn}' → '${toTable}'.'${toColumn}'`;
      let summary: string;
      if (r.alreadyExisted) {
        summary = `↩︎ Beziehung ${arrow} existierte bereits – nicht doppelt angelegt`;
      } else if (r.forcedInactive) {
        summary =
          `⚠ Beziehung ${arrow} angelegt – aber als INACTIVE, weil zwischen den Tabellen ` +
          `bereits eine aktive Beziehung existiert (${r.forcedInactiveBecauseOf}). ` +
          `Power BI erlaubt nur EINE aktive Beziehung pro Tabellenpaar (sonst PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH). ` +
          `Falls du DIESE als aktive willst, muss die alte zuerst deaktiviert/gelöscht werden.`;
      } else {
        summary = `✓ Beziehung ${arrow} angelegt`;
      }
      return {
        ...r,
        summary,
        reloadHint: "PBI Desktop schließen ohne Speichern, dann erneut öffnen.",
      };
    },
  },
  {
    name: "fix_ambiguous_relationships",
    description:
      "Repariert ein Modell mit mehrdeutigen Beziehungs-Pfaden (Power BI Fehler PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH). Entfernt exakte Duplikate (gleiches Spaltenpaar) und setzt jede zweite/weitere aktive Beziehung zwischen demselben Tabellenpaar auf inactive. Aufrufen, wenn PBI Desktop diesen Fehler beim Öffnen wirft.",
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
      const r = fixAmbiguousRelationships(path);
      const total = r.deactivatedCount + r.removedCount;
      return {
        ...r,
        summary:
          total === 0
            ? "Keine Probleme gefunden – Beziehungen sind eindeutig."
            : `Repariert: ${r.removedCount} Duplikat(e) entfernt, ${r.deactivatedCount} aktive Beziehung(en) auf inactive gesetzt.`,
        reloadHint:
          total > 0
            ? "PBI Desktop schließen ohne Speichern, dann erneut öffnen – die mehrdeutigen Pfade sollten weg sein."
            : undefined,
      };
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
    name: "add_calculated_table",
    description:
      "Legt eine neue kalkulierte Tabelle (calculated table) im PBIP-Modell an. Der DAX-Ausdruck (Single-Line) liefert die Tabelle. Beispiele: CALENDAR(...), SUMMARIZE(Sales, Customer[Region]), DISTINCT(Sales[Item]).",
    inputSchema: {
      type: "object",
      required: ["name", "expression"],
      properties: {
        pbipPath: { type: "string" },
        name: { type: "string", description: "Name der neuen Tabelle." },
        expression: {
          type: "string",
          description:
            "DAX-Tabellen-Ausdruck (single-line). Z.B. CALENDAR(DATE(2020,1,1), DATE(2030,12,31)).",
        },
        dataCategory: {
          type: "string",
          enum: ["Time", "Regular"],
          description: 'Setze "Time" für Datums-/Zeit-Dimensionen.',
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      const name = str(args.name);
      const expression = str(args.expression);
      if (!path || !name || !expression) {
        throw new Error("pbipPath, name und expression erforderlich");
      }
      const r = addCalculatedTable(path, {
        name,
        expression,
        dataCategory: args.dataCategory as "Time" | "Regular" | undefined,
      });
      return {
        ...r,
        summary: `✓ Tabelle '${r.tableName}' angelegt`,
        reloadHint:
          "PBI Desktop schließen ohne Speichern, dann erneut öffnen. Anschließend können calc columns via add_calculated_column und Beziehungen via add_relationship gesetzt werden.",
      };
    },
  },
  {
    name: "add_calculated_column",
    description:
      "Fügt einer existierenden Tabelle eine calculated column (DAX) hinzu. Single-Line-Ausdruck.",
    inputSchema: {
      type: "object",
      required: ["table", "name", "expression"],
      properties: {
        pbipPath: { type: "string" },
        table: { type: "string" },
        name: { type: "string" },
        expression: {
          type: "string",
          description: "DAX-Spalten-Ausdruck, z.B. YEAR([Date]) oder \"Q\" & FORMAT([Date], \"Q\").",
        },
        dataType: {
          type: "string",
          enum: ["int64", "double", "string", "boolean", "dateTime"],
        },
        formatString: { type: "string" },
        summarizeBy: {
          type: "string",
          enum: ["none", "sum", "average", "count", "max", "min"],
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      const table = str(args.table);
      const name = str(args.name);
      const expression = str(args.expression);
      if (!path || !table || !name || !expression) {
        throw new Error("pbipPath, table, name und expression erforderlich");
      }
      const r = addCalculatedColumn(path, {
        table,
        name,
        expression,
        dataType: args.dataType as
          | "int64"
          | "double"
          | "string"
          | "boolean"
          | "dateTime"
          | undefined,
        formatString: str(args.formatString),
        summarizeBy: args.summarizeBy as
          | "none"
          | "sum"
          | "average"
          | "count"
          | "max"
          | "min"
          | undefined,
      });
      return {
        ...r,
        summary: `✓ Calc Column '${name}' in Tabelle '${table}' angelegt`,
        reloadHint: "PBI Desktop schließen ohne Speichern, dann erneut öffnen.",
      };
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
        summary: `✓ Datumstabelle '${r.tableName}' angelegt (Date, Year, Quarter, Month, MonthName, YearMonth)`,
        reloadHint:
          "Nach dem Reload in PBI Desktop: Beziehung der Faktentabelle (Datums-Spalte) auf Date.Date anlegen via add_relationship.",
      };
    },
  },
  {
    name: "verify_model",
    description:
      "Prüft am Ende einer Modellierungs-Session, ob die geplanten Tabellen, Beziehungen und Measures wirklich im Modell stehen, ob die Datumstabelle gültig ist und ob keine doppelten Beziehungen existieren. Liefert eine Liste 'ok'/'missing' pro erwartetem Element. Soll IMMER aufgerufen werden, nachdem add_*-Tools fertig sind.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: { type: "string" },
        expectedTables: {
          type: "array",
          items: { type: "string" },
          description: "Tabellen, die existieren sollen.",
        },
        expectedRelationships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fromTable: { type: "string" },
              fromColumn: { type: "string" },
              toTable: { type: "string" },
              toColumn: { type: "string" },
            },
          },
        },
        expectedMeasures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              table: { type: "string" },
              name: { type: "string" },
            },
          },
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);
      const model = listModel(path);

      const expectedTables = (args.expectedTables as string[] | undefined) ?? [];
      const expectedRels =
        (args.expectedRelationships as
          | Array<{ fromTable?: string; fromColumn?: string; toTable?: string; toColumn?: string }>
          | undefined) ?? [];
      const expectedMeasures =
        (args.expectedMeasures as Array<{ table?: string; name?: string }> | undefined) ?? [];

      const tableNames = new Set(model.tables.map((t) => t.name));
      const tableChecks = expectedTables.map((t) => ({
        table: t,
        ok: tableNames.has(t),
      }));

      const relPairs = new Set(
        model.relationships.map(
          (r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`
        )
      );
      const relChecks = expectedRels.map((r) => {
        const fwd = `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`;
        const bwd = `${r.toTable}.${r.toColumn}->${r.fromTable}.${r.fromColumn}`;
        return { ...r, ok: relPairs.has(fwd) || relPairs.has(bwd) };
      });

      const measureChecks = expectedMeasures.map((em) => {
        const tbl = model.tables.find((t) => t.name === em.table);
        return {
          ...em,
          ok: !!tbl?.measures.some((m) => m.name === em.name),
        };
      });

      // Doppelte Beziehungen finden (gleiche Spaltenpaare > 1x)
      const seen = new Map<string, number>();
      for (const r of model.relationships) {
        const key = [
          [r.fromTable, r.fromColumn].sort().join("|"),
          [r.toTable, r.toColumn].sort().join("|"),
        ]
          .sort()
          .join("=");
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const duplicates = [...seen.entries()].filter(([, n]) => n > 1).length;

      // Mehrdeutige Pfade: pro Tabellenpaar > 1 active relationship
      const activePerTablePair = new Map<string, number>();
      for (const r of model.relationships) {
        if (!r.isActive) continue;
        const k = [r.fromTable, r.toTable].sort().join("=");
        activePerTablePair.set(k, (activePerTablePair.get(k) ?? 0) + 1);
      }
      const ambiguousPaths = [...activePerTablePair.entries()]
        .filter(([, n]) => n > 1)
        .map(([k, n]) => ({ tablePair: k.replace("=", " ↔ "), activeCount: n }));

      // Datumstabelle gültig? (Date-Spalte vom Typ dateTime mit isKey, plus
      // mind. 3 weitere Spalten Year/Month/o.ä.)
      const dateTable = model.tables.find((t) => t.name === "Date");
      const dateOk =
        !!dateTable &&
        dateTable.columns.some((c) => c.name === "Date" && c.dataType === "dateTime") &&
        dateTable.columns.length >= 3;

      const allTablesOk = tableChecks.every((c) => c.ok);
      const allRelsOk = relChecks.every((c) => c.ok);
      const allMeasuresOk = measureChecks.every((c) => c.ok);

      const overall =
        allTablesOk &&
        allRelsOk &&
        allMeasuresOk &&
        duplicates === 0 &&
        ambiguousPaths.length === 0;

      const summaryLines: string[] = [];
      if (tableChecks.length) {
        const ok = tableChecks.filter((c) => c.ok).length;
        summaryLines.push(`Tabellen: ${ok}/${tableChecks.length} ✓`);
      }
      if (relChecks.length) {
        const ok = relChecks.filter((c) => c.ok).length;
        summaryLines.push(`Beziehungen: ${ok}/${relChecks.length} ✓`);
      }
      if (measureChecks.length) {
        const ok = measureChecks.filter((c) => c.ok).length;
        summaryLines.push(`Measures: ${ok}/${measureChecks.length} ✓`);
      }
      if (dateTable) summaryLines.push(`Datumstabelle: ${dateOk ? "ok" : "unvollständig"}`);
      if (duplicates > 0) summaryLines.push(`⚠️ ${duplicates} doppelte Beziehung(en)`);
      if (ambiguousPaths.length > 0) {
        summaryLines.push(
          `🚨 ${ambiguousPaths.length} mehrdeutige Pfad(e) – ruf fix_ambiguous_relationships auf`
        );
      }

      return {
        ok: overall,
        summary: summaryLines.join(" · ") || "Keine Erwartungen geprüft.",
        tableChecks,
        relChecks,
        measureChecks,
        dateTableOk: dateOk,
        duplicateRelationships: duplicates,
        ambiguousPaths,
        actualTables: model.tables.map((t) => t.name),
        actualRelationships: model.relationships.map(
          (r) =>
            `${r.fromTable}.${r.fromColumn}→${r.toTable}.${r.toColumn}` +
            (r.isActive ? "" : " (inactive)")
        ),
        actualMeasures: model.tables.flatMap((t) =>
          t.measures.map((m) => `${t.name}.${m.name}`)
        ),
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
