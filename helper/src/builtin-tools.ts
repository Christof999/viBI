// Built-in tools that the helper itself implements (no MCP server needed).
// Advertised under server="helper" via /mcp/tools so the chat can call them
// even when no Fabric/Custom MCP is connected.

import { existsSync } from "node:fs";
import { applyFullPageHTML, applyNativePowerBIReport, readMetadata } from "./pbip.js";
import { loadLibrary, locateProject } from "./library.js";
import { mcpRegistry } from "./mcp.js";
import {
  addCalculatedColumn,
  addCalculatedTable,
  addDateTable,
  addMeasure,
  addRelationship,
  fixAmbiguousRelationships,
  htmlToDaxLiteral,
  listModel,
  removeMeasure,
  removeRelationship,
  restoreTmdlBackups,
} from "./tmdl.js";
import { looksLikeViBIPlaceholder, readLiveModel } from "./live-model.js";
import { bestPbipFor, findRecentPbips } from "./pbip-discovery.js";
import { getDesignHtml, setDesignHtml, writeStandaloneHtml } from "./design.js";

export interface BuiltInTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function looksLikeDateColumn(name: string, dataType?: string): boolean {
  return (
    dataType === "dateTime" ||
    /date|datum|posting|buchungs|period|periode|month|monat|year|jahr/i.test(name)
  );
}

function looksLikeKeyColumn(name: string): boolean {
  return /(^|[_\s-])(id|key|nr|no|code|nummer|number)([_\s-]|$)/i.test(name);
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
      "ALIAS für embed_full_page_html. Bevorzugt embed_full_page_html aufrufen – dieses Tool nimmt das HTML, schreibt eine 'Dashboard HTML'-Measure auf die Date-Tabelle und platziert das HTML-Content-Visual page-fillend auf Seite 1 mit Measure-Binding.",
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
      const dax = htmlToDaxLiteral(html);
      const r = addMeasure(path, {
        table: "Date",
        name: "Dashboard HTML",
        expression: dax,
        displayFolder: "_viBI",
        replace: true,
      });
      let reportJsonPath: string | null = null;
      try {
        reportJsonPath = applyFullPageHTML(path, html, {
          measureTable: "Date",
          measureName: "Dashboard HTML",
        });
      } catch {
        /* non-critical */
      }
      const standalone = writeStandaloneHtml(path, html);
      setDesignHtml(path, html);
      return {
        ok: true,
        measurePath: r.path,
        measureName: "Dashboard HTML",
        table: "Date",
        replaced: !!r.replaced,
        reportJsonPath,
        standalonePath: standalone,
        summary: `${r.replaced ? "↻" : "✓"} Measure 'Dashboard HTML' geschrieben${reportJsonPath ? " · Visual auf Seite 1 platziert" : ""}.`,
      };
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
      // AI-Sicht: Auto-Date-System-Tabellen (LocalDateTable_*, DateTableTemplate_*)
      // ausblenden, sonst plant die KI Beziehungen zu Phantom-Tabellen. Intern
      // bleiben sie für orphan-Erkennung sichtbar.
      const userTables = tmdl.tables.filter(
        (t) =>
          !t.name.startsWith("LocalDateTable") &&
          !t.name.startsWith("DateTableTemplate")
      );
      const userRels = tmdl.relationships.filter(
        (r) =>
          !r.fromTable.startsWith("LocalDateTable") &&
          !r.toTable.startsWith("LocalDateTable") &&
          !r.fromTable.startsWith("DateTableTemplate") &&
          !r.toTable.startsWith("DateTableTemplate")
      );
      const placeholder = looksLikeViBIPlaceholder(userTables);
      return {
        pbipPath: tmdl.pbipPath,
        layout: tmdl.layout,
        source: "tmdl",
        tables: userTables,
        relationships: userRels,
        ...(placeholder
          ? {
              placeholderWarning:
                "Diese TMDL enthält nur die viBI-Initial-Datumstabelle. Sage dem User, dass er den .pbip in Power BI Desktop öffnen, Faktentabellen importieren UND speichern (Strg+S) muss. Erfinde KEINE Modellstruktur.",
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
    name: "get_full_page_html",
    description:
      "Liest das aktuell gestaltete page-fillende HTML des Berichts (gespeichert neben der .pbip als .vibi-design.html). Wenn nichts gespeichert ist, liefert null. Im Design-Phase IMMER zuerst aufrufen, bevor du das HTML änderst – sonst überschreibst du das Frontend.",
    inputSchema: {
      type: "object",
      properties: { pbipPath: { type: "string" } },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const html = getDesignHtml(path);
      return {
        exists: html !== null,
        html: html ?? "",
        characterCount: html?.length ?? 0,
        summary:
          html === null
            ? "Noch kein Design-HTML gespeichert."
            : `Aktuelles Design-HTML: ${html.length.toLocaleString("de-DE")} Zeichen`,
      };
    },
  },
  {
    name: "update_full_page_html",
    description:
      "Aktualisiert das page-fillende HTML des Berichts. Liefere ein vollständiges, valides HTML-Dokument (mit <html>, <head><style>, <body>) – KEINE Snippets, weil das Visual später als Ganzes eingebettet wird. Das Frontend zeigt Live-Preview im iframe; eingebettet wird erst, wenn der User auf 'In Bericht einbetten' klickt oder du embed_full_page_html aufrufst.",
    inputSchema: {
      type: "object",
      required: ["html"],
      properties: {
        pbipPath: { type: "string" },
        html: {
          type: "string",
          description:
            "Komplettes HTML-Dokument. Muss <html>, <head> mit <style>, <body> enthalten. Inline-CSS bevorzugen, damit nichts extern geladen werden muss.",
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      const html = str(args.html);
      if (!path) throw new Error("pbipPath erforderlich");
      if (!html) throw new Error("html erforderlich");
      const out = setDesignHtml(path, html);
      return {
        ok: true,
        path: out,
        characterCount: html.length,
        summary: `✓ Design-HTML aktualisiert (${html.length.toLocaleString("de-DE")} Zeichen). Vorschau im DesignPanel aktualisiert sich automatisch.`,
      };
    },
  },
  {
    name: "replace_in_html",
    description:
      "Surgischer Find-and-Replace im aktuell gespeicherten Design-HTML. NUTZE DIESES TOOL FÜR KLEINE ÄNDERUNGEN (Farben, einzelne Texte, Werte) statt das ganze HTML neu zu emittieren. Beispiel: replace_in_html({find: '#F2C811', replaceWith: '#CCCCCC'}) tauscht eine Akzentfarbe. Nach dem Aufruf zeigt die Live-Vorschau im DesignPanel automatisch (Polling alle 2.5s) das Ergebnis.",
    inputSchema: {
      type: "object",
      required: ["find", "replaceWith"],
      properties: {
        pbipPath: { type: "string" },
        find: {
          type: "string",
          description:
            "Exakter String, der im aktuellen HTML gesucht wird. Case-sensitive. Bei Hex-Farben den führenden # mitnehmen.",
        },
        replaceWith: {
          type: "string",
          description: "Ersetzungsstring. Leerstring zum Löschen erlaubt.",
        },
        all: {
          type: "boolean",
          description: "Alle Vorkommen ersetzen (default true). Bei false nur das erste.",
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const find = str(args.find);
      const replaceWith = typeof args.replaceWith === "string" ? args.replaceWith : "";
      if (!find) throw new Error("find darf nicht leer sein");
      const current = getDesignHtml(path);
      if (current === null) {
        throw new Error(
          "Noch kein Design-HTML gespeichert. Erst get_full_page_html aufrufen oder die Design-Phase betreten."
        );
      }
      const all = args.all !== false;
      let count = 0;
      let next: string;
      if (all) {
        // String.split/join um ALLE Vorkommen ohne RegEx-Escape zu treffen
        const parts = current.split(find);
        count = parts.length - 1;
        next = parts.join(replaceWith);
      } else {
        const idx = current.indexOf(find);
        if (idx >= 0) {
          next = current.slice(0, idx) + replaceWith + current.slice(idx + find.length);
          count = 1;
        } else {
          next = current;
        }
      }
      if (count === 0) {
        return {
          ok: false,
          replacements: 0,
          summary: `⚠ '${find}' nicht im aktuellen HTML gefunden. Rufe get_full_page_html auf, um den echten Inhalt zu sehen.`,
        };
      }
      setDesignHtml(path, next);
      return {
        ok: true,
        replacements: count,
        before: current.length,
        after: next.length,
        summary: `✓ ${count}× '${find.slice(0, 40)}${find.length > 40 ? "…" : ""}' → '${replaceWith.slice(0, 40)}${replaceWith.length > 40 ? "…" : ""}' ersetzt. Live-Vorschau aktualisiert sich in 1-3s automatisch.`,
      };
    },
  },
  {
    name: "embed_full_page_html",
    description:
      "Bettet das aktuell gespeicherte Design-HTML als DAX-Measure in den PBIP-Bericht ein. Das ist der RICHTIGE Power-BI-Weg: HTML kommt als Stringliteral in eine Measure, die der User im 'HTML Content'-Custom-Visual als Value bindet. Schreibt die Measure 'Dashboard HTML' auf die Date-Tabelle (oder die übergebene table). Schreibt zusätzlich eine standalone vibi-design.html in StaticResources.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: { type: "string" },
        html: { type: "string", description: "Optional. Default = der per update_full_page_html gespeicherte Stand." },
        table: { type: "string", description: "Tabelle für die Measure. Default 'Date'." },
        measureName: { type: "string", description: "Name der Measure. Default 'Dashboard HTML'." },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      const html = str(args.html) ?? getDesignHtml(path);
      if (!html) {
        throw new Error(
          "Kein HTML übergeben und keins gespeichert. Erst update_full_page_html aufrufen oder html-Parameter übergeben."
        );
      }
      const table = str(args.table) ?? "Date";
      const measureName = str(args.measureName) ?? "Dashboard HTML";
      const dax = htmlToDaxLiteral(html);

      let measurePath: string | null = null;
      let measureError: string | null = null;
      let replaced = false;
      try {
        const r = addMeasure(path, {
          table,
          name: measureName,
          expression: dax,
          displayFolder: "_viBI",
          replace: true,
        });
        measurePath = r.path;
        replaced = !!r.replaced;
      } catch (e) {
        measureError = (e as Error).message;
      }

      // Visual auf Page1 platzieren mit Binding an die Measure
      let reportJsonPath: string | null = null;
      let visualPlaced = false;
      try {
        reportJsonPath = applyFullPageHTML(path, html, {
          measureTable: table,
          measureName,
        });
        visualPlaced = !!reportJsonPath;
      } catch {
        /* non-critical */
      }

      const standalonePath = writeStandaloneHtml(path, html);
      setDesignHtml(path, html);

      const charCount = html.length.toLocaleString("de-DE");
      const visualNote = visualPlaced
        ? " Visual auf Seite 1 platziert (HTML-Content-Visual htmlContent443BE3AD55E043BF878BED274D3A6855, Measure gebunden)."
        : "";

      // Verify: GENAU eine Measure mit dem Namen muss existieren.
      // Wenn 0 → Schreibvorgang fehlgeschlagen.
      // Wenn ≥2 → Duplikat-Bug; sofort entfernen und neu schreiben, sonst
      //           wirft PBI Desktop "TMDL-Objekte können nicht zusammengeführt
      //           werden, weil beide die gleiche Eigenschaft expression
      //           deklarieren".
      let verified = false;
      let verifyError: string | null = null;
      try {
        let model = listModel(path);
        let tbl = model.tables.find((t) => t.name === table);
        let matches = tbl?.measures.filter((mm) => mm.name === measureName) ?? [];
        if (matches.length > 1) {
          // Duplikat erkannt → alle entfernen und genau eine neu schreiben
          for (let i = 0; i < 10; i++) {
            const r = removeMeasure(path, table, measureName);
            if (!r.ok) break;
          }
          // neu hinzufügen ohne replace (sonst rekursiv)
          addMeasure(path, {
            table,
            name: measureName,
            expression: dax,
            displayFolder: "_viBI",
          });
          model = listModel(path);
          tbl = model.tables.find((t) => t.name === table);
          matches = tbl?.measures.filter((mm) => mm.name === measureName) ?? [];
        }
        if (matches.length === 1 && matches[0].expression && matches[0].expression.length > 10) {
          verified = true;
        } else if (matches.length > 1) {
          verifyError = `Duplikat-Bereinigung fehlgeschlagen: noch ${matches.length} Measures mit Namen '${measureName}'`;
        } else if (matches.length === 0) {
          verifyError = `Measure '${measureName}' nach Schreibvorgang nicht auffindbar`;
        } else {
          verifyError = "Measure existiert, aber Ausdruck leer/zu kurz";
        }
      } catch (e) {
        verifyError = (e as Error).message;
      }

      const summary = measurePath
        ? `${replaced ? "↻" : "✓"} Measure '${measureName}' auf Tabelle '${table}' gesetzt (${charCount} Zeichen HTML als DAX-String).${visualNote}${
            verified ? " Verify ✓" : ` ⚠ Verify fehlgeschlagen: ${verifyError ?? "unbekannt"}`
          }`
        : `⚠ Measure-Schreibvorgang fehlgeschlagen (${measureError}). HTML aber als ${standalonePath} gesichert.`;

      return {
        ok: !!measurePath,
        measurePath,
        measureName,
        table,
        replaced,
        reportJsonPath,
        standalonePath,
        visualPlaced,
        embedError: measureError,
        summary,
        userInstructions: [
          "1. PBI Desktop schließen (ohne Speichern!) und erneut öffnen.",
          visualPlaced
            ? "2. Auf Seite 1 ist das page-fillende 'HTML Content'-Visual bereits platziert und an die Measure gebunden. Falls PBI Desktop 'Visual fehlt' anzeigt: einmalig die Erweiterung von https://html-content.com installieren – das Visual wird automatisch ersetzt, Bindung bleibt."
            : "2. 'HTML Content'-Visual von https://html-content.com installieren und auf der Seite einfügen.",
          visualPlaced
            ? "3. Wiederholtes embed_full_page_html aktualisiert nur die Measure – Visual und Position bleiben."
            : `3. Measure '${measureName}' (Tabelle '${table}', Anzeige-Ordner '_viBI') als 'Value' des HTML-Visuals binden.`,
        ],
        reloadHint: "PBI Desktop schließen ohne Speichern, dann erneut öffnen.",
      };
    },
  },
  {
    name: "create_powerbi_report_visuals",
    description:
      "Erstellt native Power-BI-Visuals direkt in report.json: Slicer für Filter, KPI-Karten für Measures, ein Balkendiagramm und eine Tabelle. Vorher list_model nutzen, notwendige Measures/Beziehungen per add_measure/add_relationship anlegen und verify_model ausführen. Dieses Tool bindet echte DAX-Measures/Spalten an die Visuals, keine HTML-Platzhalter.",
    inputSchema: {
      type: "object",
      properties: {
        pbipPath: { type: "string" },
        title: { type: "string", description: "Seitentitel, Default: PowerBI Visuals." },
        subtitle: { type: "string" },
        measureNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: gewünschte Measure-Namen. Ohne Angabe werden vorhandene Measures außer 'Dashboard HTML' verwendet.",
        },
        slicers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              table: { type: "string" },
              column: { type: "string" },
            },
          },
          description:
            "Optional: Slicer-Spalten. Ohne Angabe wählt viBI Datum-/Jahr-/Monat-Spalten und eine sinnvolle Textdimension.",
        },
        category: {
          type: "object",
          properties: {
            table: { type: "string" },
            column: { type: "string" },
          },
          description:
            "Optional: Kategorie für Balkendiagramm und Tabelle, z.B. Customer[Name] oder Item[Category].",
        },
      },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);

      const model = listModel(path);
      const measureNames = new Set(arr(args.measureNames).map((m) => String(m).toLowerCase()));
      const allMeasures = model.tables.flatMap((table) =>
        table.measures.map((measure) => ({ table: table.name, name: measure.name }))
      );
      const measures = allMeasures
        .filter((measure) => measure.name !== "Dashboard HTML")
        .filter((measure) => measureNames.size === 0 || measureNames.has(measure.name.toLowerCase()))
        .slice(0, 6);

      if (measures.length === 0) {
        throw new Error(
          "Keine passenden Measures gefunden. Lege zuerst KPI-Measures per add_measure an und rufe danach create_powerbi_report_visuals erneut auf."
        );
      }

      const tableMap = new Map(model.tables.map((table) => [table.name, table]));
      const providedSlicers = arr(args.slicers)
        .map((item) => {
          const raw = item as { table?: unknown; column?: unknown };
          const table = str(raw.table);
          const column = str(raw.column);
          const col = tableMap.get(table ?? "")?.columns.find((c) => c.name === column);
          return table && column && col ? { table, column, dataType: col.dataType } : null;
        })
        .filter(Boolean) as { table: string; column: string; dataType?: string }[];

      const candidateSlicerColumns = model.tables
        .flatMap((table) =>
          table.columns.map((column) => ({
            table: table.name,
            column: column.name,
            dataType: column.dataType,
            score:
              (looksLikeDateColumn(column.name, column.dataType) ? 4 : 0) +
              (column.dataType === "string" ? 2 : 0) -
              (looksLikeKeyColumn(column.name) ? 2 : 0),
          }))
        )
        .filter((field) => field.score > 0)
        .sort((a, b) => b.score - a.score);
      const slicers = (providedSlicers.length ? providedSlicers : candidateSlicerColumns)
        .filter(
          (field, index, list) =>
            list.findIndex((other) => other.table === field.table && other.column === field.column) === index
        )
        .slice(0, 3);

      const rawCategory = args.category as { table?: unknown; column?: unknown } | undefined;
      const categoryTable = str(rawCategory?.table);
      const categoryColumn = str(rawCategory?.column);
      const providedCategory =
        categoryTable && categoryColumn
          ? tableMap.get(categoryTable)?.columns.find((c) => c.name === categoryColumn)
          : undefined;
      const category =
        providedCategory && categoryTable && categoryColumn
          ? { table: categoryTable, column: categoryColumn, dataType: providedCategory.dataType }
          : model.tables
              .flatMap((table) =>
                table.columns.map((column) => ({
                  table: table.name,
                  column: column.name,
                  dataType: column.dataType,
                  score:
                    (column.dataType === "string" ? 4 : 0) -
                    (looksLikeKeyColumn(column.name) ? 3 : 0) -
                    (looksLikeDateColumn(column.name, column.dataType) ? 1 : 0),
                }))
              )
              .filter((field) => field.score > 0)
              .sort((a, b) => b.score - a.score)[0];

      const reportJsonPath = applyNativePowerBIReport(path, {
        title: str(args.title) ?? "PowerBI Visuals",
        subtitle: str(args.subtitle),
        measures,
        slicers,
        category,
      });

      return {
        ok: true,
        reportJsonPath,
        visuals: {
          slicers,
          cards: measures.slice(0, 4),
          barChart: category ? { category, measure: measures[0] } : null,
          table: category ? { category, measures: measures.slice(0, 5) } : null,
        },
        relationshipCount: model.relationships.length,
        summary:
          `✓ Native PowerBI-Visuals in report.json erstellt: ${slicers.length} Slicer, ` +
          `${Math.min(measures.length, 4)} KPI-Karte(n)` +
          `${category ? ", Balkendiagramm und Tabelle" : ""}.`,
        reloadHint:
          "PBI Desktop schließen ohne Speichern, dann erneut öffnen. Die Visuals sind direkt an die vorhandenen Measures/Spalten gebunden.",
      };
    },
  },
  {
    name: "restore_tmdl_backup",
    description:
      "Stellt im PBIP-Bericht alle TMDL-Dateien aus ihren .tmdl.bak-Backups wieder her. Nutze dies, wenn ein viBI-Tool das Modell beschädigt hat (z.B. PBI Desktop wirft Variation-/Relationship-Fehler beim Öffnen). Der bisherige Stand wird als .tmdl.before-restore weggesichert, falls man doch noch zurück will.",
    inputSchema: {
      type: "object",
      properties: { pbipPath: { type: "string" } },
    },
    async handler(args) {
      const path = str(args.pbipPath);
      if (!path) throw new Error("pbipPath erforderlich");
      if (!existsSync(path)) throw new Error(`PBIP nicht gefunden: ${path}`);
      const r = restoreTmdlBackups(path);
      return {
        ...r,
        summary:
          r.restoredCount === 0
            ? "Keine .tmdl.bak-Dateien gefunden – nichts zum Wiederherstellen."
            : `↩ ${r.restoredCount} TMDL-Datei(en) aus .bak wiederhergestellt`,
        reloadHint:
          r.restoredCount > 0
            ? "PBI Desktop schließen ohne Speichern, dann erneut öffnen – das Modell sollte wieder funktionieren."
            : undefined,
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
      const total = r.deactivatedCount + r.removedCount + r.brokenRemovedCount;
      return {
        ...r,
        summary:
          total === 0
            ? "Keine Probleme gefunden – Beziehungen sind eindeutig und valide."
            : `Repariert: ${r.brokenRemovedCount} orphan, ${r.removedCount} Duplikat(e), ${r.deactivatedCount} aktive auf inactive gesetzt.`,
        reloadHint:
          total > 0
            ? "PBI Desktop schließen ohne Speichern, dann erneut öffnen – die Probleme sollten weg sein."
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

      // Beziehungen mit nicht existierenden Tabellen/Spalten finden – die
      // sind die häufigste Ursache für PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH-
      // ähnliche Loadfehler (PBI verwirft die Beziehung dann nicht stumm,
      // sondern probiert Auto-Detection und scheitert).
      const tableMap = new Map(model.tables.map((t) => [t.name, t]));
      const brokenRelationships = model.relationships
        .map((r) => {
          const fromT = tableMap.get(r.fromTable);
          const toT = tableMap.get(r.toTable);
          const issues: string[] = [];
          if (!fromT) issues.push(`fromTable '${r.fromTable}' fehlt`);
          else if (!fromT.columns.find((c) => c.name === r.fromColumn))
            issues.push(`Spalte '${r.fromTable}'.'${r.fromColumn}' fehlt`);
          if (!toT) issues.push(`toTable '${r.toTable}' fehlt`);
          else if (!toT.columns.find((c) => c.name === r.toColumn))
            issues.push(`Spalte '${r.toTable}'.'${r.toColumn}' fehlt`);
          return issues.length ? { id: r.id, issues } : null;
        })
        .filter(Boolean);

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
        ambiguousPaths.length === 0 &&
        brokenRelationships.length === 0;

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
      if (brokenRelationships.length > 0) {
        summaryLines.push(
          `🚨 ${brokenRelationships.length} Beziehung(en) referenzieren nicht-existierende Spalten – ruf fix_ambiguous_relationships auf, um sie zu entfernen`
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
        brokenRelationships,
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
