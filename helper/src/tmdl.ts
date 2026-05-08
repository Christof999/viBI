// Pragmatic TMDL editor: liest und schreibt model.tmdl direkt im PBIP-Projekt.
//
// Funktioniert über Text-Manipulation – kein vollständiger TMDL-Parser, sondern
// gezielte Inserts in bekannte Strukturen. Power BI Desktop liest die TMDL beim
// Laden des Projekts; nach Änderungen muss der User in PBI Desktop "Datei →
// Schließen ohne Speichern → erneut öffnen" oder Desktop neu starten.
//
// Erzeugt für jede Mutation einen .tmdl.bak-Snapshot, damit nichts unwiderruflich
// kaputtgeht.

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { concatenatedTmdl, discoverModel } from "./tmdl-discovery.js";

function modelTmdlPath(pbipPath: string): string {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  return join(projectDir, `${projName}.SemanticModel`, "definition", "model.tmdl");
}

function backupAndWrite(filePath: string, content: string): string {
  if (existsSync(filePath)) {
    try {
      copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      /* best effort */
    }
  }
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// Findet die TMDL-Datei, die die gegebene Tabelle definiert. Funktioniert für
// single-file (model.tmdl mit allem inline) und sharded (tables/<Name>.tmdl).
function findTableFile(
  pbipPath: string,
  tableName: string
): { filePath: string; content: string } | null {
  const d = discoverModel(pbipPath);
  if (d.layout === "bim" || d.layout === "none") return null;
  const re = new RegExp(`(?:^|\\n)table\\s+(?:'${escapeRegex(tableName)}'|${escapeRegex(tableName)})\\b`);
  for (const f of d.files) {
    if (re.test(f.content)) return { filePath: f.path, content: f.content };
  }
  return null;
}

function relationshipsFilePath(pbipPath: string): string {
  const d = discoverModel(pbipPath);
  // Sharded layout → eigene Datei
  if (d.layout === "sharded") {
    return join(d.definitionDir, "relationships.tmdl");
  }
  // Single-file → an model.tmdl anhängen
  return modelTmdlPath(pbipPath);
}

// Gibt die Zeilenposition (start, endExklusiv) eines Blocks zurück, der mit
// `header` beginnt und bis vor den nächsten Top-Level-Block (Zeile beginnt mit
// Buchstaben) oder Dateiende läuft. Top-Level-Blöcke sind: model, table,
// relationship, role, perspective, expression, dataSource.
function findBlock(
  src: string,
  header: RegExp
): { start: number; end: number } | null {
  const lines = src.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (header.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  const topLevel = /^(model|table|relationship|role|perspective|expression|dataSource|annotation)\b/;
  for (let j = start + 1; j < lines.length; j++) {
    if (topLevel.test(lines[j])) {
      end = j;
      break;
    }
  }
  return { start, end };
}

function joinBlock(lines: string[]): string {
  return lines.join("\n");
}

export interface ListedTable {
  name: string;
  columns: { name: string; dataType: string }[];
  measures: { name: string; expression: string }[];
}
export interface ListedRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export function listModel(pbipPath: string): {
  pbipPath: string;
  layout: string;
  tables: ListedTable[];
  relationships: ListedRelationship[];
} {
  const d = discoverModel(pbipPath);
  if (d.layout === "none") {
    return { pbipPath, layout: d.layout, tables: [], relationships: [] };
  }

  // .bim → JSON
  if (d.layout === "bim" && d.bimJson) {
    const json = d.bimJson as {
      model?: {
        tables?: Array<{
          name: string;
          columns?: Array<{ name: string; dataType?: string }>;
          measures?: Array<{ name: string; expression?: string | string[] }>;
        }>;
        relationships?: Array<{
          name?: string;
          fromTable?: string;
          fromColumn?: string;
          toTable?: string;
          toColumn?: string;
        }>;
      };
    };
    const m = json.model ?? json;
    const tablesIn = (m as { tables?: unknown[] }).tables ?? [];
    const relsIn = (m as { relationships?: unknown[] }).relationships ?? [];
    const tables: ListedTable[] = (tablesIn as Array<{
      name: string;
      columns?: Array<{ name: string; dataType?: string }>;
      measures?: Array<{ name: string; expression?: string | string[] }>;
    }>)
      .filter((t) => !t.name.startsWith("DateTableTemplate") && !t.name.startsWith("LocalDateTable"))
      .map((t) => ({
        name: t.name,
        columns: (t.columns ?? [])
          .filter((c) => !c.name.startsWith("RowNumber-"))
          .map((c) => ({ name: c.name, dataType: c.dataType ?? "unknown" })),
        measures: (t.measures ?? []).map((mm) => ({
          name: mm.name,
          expression: Array.isArray(mm.expression) ? mm.expression.join("\n") : mm.expression ?? "",
        })),
      }));
    const relationships: ListedRelationship[] = (relsIn as Array<{
      name?: string;
      fromTable?: string;
      fromColumn?: string;
      toTable?: string;
      toColumn?: string;
    }>).map((r) => ({
      id: r.name ?? "",
      fromTable: r.fromTable ?? "",
      fromColumn: r.fromColumn ?? "",
      toTable: r.toTable ?? "",
      toColumn: r.toColumn ?? "",
    }));
    return { pbipPath, layout: d.layout, tables, relationships };
  }

  const src = concatenatedTmdl(d);
  const tables: ListedTable[] = [];
  // table 'Name' ODER table Name; bis zur nächsten table/file-marker oder EOF
  const tableRe = /(?:^|\n)table\s+(?:'([^']+)'|(\S+))([\s\S]*?)(?=\ntable\s+(?:'[^']+'|\S+)|\n### __VIBI_FILE__|$)/g;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(src))) {
    const name = match[1] ?? match[2];
    const body = match[3];
    if (name.startsWith("DateTableTemplate") || name.startsWith("LocalDateTable")) continue;
    const cols: { name: string; dataType: string }[] = [];
    const colRe = /column\s+(?:'([^']+)'|(\S+))[\s\S]*?dataType:\s*(\w+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = colRe.exec(body))) {
      const colName = cm[1] ?? cm[2];
      if (colName.startsWith("RowNumber-")) continue;
      cols.push({ name: colName, dataType: cm[3] });
    }
    const measures: { name: string; expression: string }[] = [];
    const mRe = /measure\s+(?:'([^']+)'|(\S+))\s*=\s*([^\n]+(?:\n[\t ]+[^\n]+)*)/g;
    let mm: RegExpExecArray | null;
    while ((mm = mRe.exec(body))) {
      measures.push({ name: mm[1] ?? mm[2], expression: (mm[3] ?? "").trim() });
    }
    tables.push({ name, columns: cols, measures });
  }

  const relationships: ListedRelationship[] = [];
  const relRe = /(?:^|\n)relationship\s+(\S+)\s*\n([\s\S]*?)(?=\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\b|\n### __VIBI_FILE__|$)/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(src))) {
    const id = rm[1];
    const body = rm[2];
    // Die zerteilten Files nutzen "fromColumn: Tabelle.Spalte" UND "toColumn: ...".
    let fromTable = "";
    let fromColumn = "";
    let toTable = "";
    let toColumn = "";
    const fromCol = body.match(/fromColumn:\s*(\S+)/);
    const toCol = body.match(/toColumn:\s*(\S+)/);
    if (fromCol) {
      const parts = fromCol[1].replace(/^'|'$/g, "").split(".");
      if (parts.length >= 2) {
        fromTable = parts[0].replace(/'/g, "");
        fromColumn = parts.slice(1).join(".").replace(/'/g, "");
      } else {
        fromColumn = fromCol[1];
        fromTable = body.match(/fromTable:\s*(\S+)/)?.[1] ?? "";
      }
    }
    if (toCol) {
      const parts = toCol[1].replace(/^'|'$/g, "").split(".");
      if (parts.length >= 2) {
        toTable = parts[0].replace(/'/g, "");
        toColumn = parts.slice(1).join(".").replace(/'/g, "");
      } else {
        toColumn = toCol[1];
        toTable = body.match(/toTable:\s*(\S+)/)?.[1] ?? "";
      }
    }
    relationships.push({ id, fromTable, fromColumn, toTable, toColumn });
  }

  return { pbipPath, layout: d.layout, tables, relationships };
}

// TMDL-Helfer für Strings + Identifier
function tmdlString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function tmdlIdent(s: string): string {
  // einfache Identifier (Buchstaben/Ziffern/Unterstrich/Bindestrich) ohne Quotes;
  // alles andere in einfache Quotes packen, mit Verdoppelung als Escape.
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

export function addMeasure(
  pbipPath: string,
  args: {
    table: string;
    name: string;
    expression: string;
    formatString?: string;
    displayFolder?: string;
  }
): { ok: true; path: string } {
  const file = findTableFile(pbipPath, args.table);
  if (!file) throw new Error(`Tabelle '${args.table}' nicht im Modell gefunden`);
  const block = findBlock(
    file.content,
    new RegExp(`^table\\s+(?:'${escapeRegex(args.table)}'|${escapeRegex(args.table)})\\b`)
  );
  if (!block) throw new Error(`Tabellen-Block in ${file.filePath} nicht parsbar`);
  const lines = file.content.split(/\r?\n/);
  const insertAt = block.end;

  const expr = args.expression.trim();
  const properties: string[] = [];
  if (args.formatString) properties.push(`\t\tformatString: ${tmdlString(args.formatString)}`);
  if (args.displayFolder) properties.push(`\t\tdisplayFolder: ${tmdlIdent(args.displayFolder)}`);

  let insert: string[];
  if (!expr.includes("\n")) {
    // Single-line: Ausdruck DIREKT auf der `=`-Zeile, sonst frisst der Parser
    // Properties wie formatString/displayFolder als Fortsetzung der DAX.
    insert = ["", `\tmeasure '${args.name}' = ${expr}`, ...properties, ""];
  } else {
    // Multi-line: Triple-Backtick-Fence. Inhalt im Fence wird vom Parser
    // verbatim gelesen; Properties stehen erst NACH dem schließenden Fence.
    const exprLines = expr.split(/\r?\n/);
    insert = [
      "",
      `\tmeasure '${args.name}' = \`\`\``,
      ...exprLines.map((l) => `\t\t${l}`),
      `\t\t\`\`\``,
      ...properties,
      "",
    ];
  }
  lines.splice(insertAt, 0, ...insert);
  return { ok: true, path: backupAndWrite(file.filePath, joinBlock(lines)) };
}

export function addRelationship(
  pbipPath: string,
  args: {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    crossFilteringBehavior?: "automatic" | "bothDirections" | "oneDirection";
    isActive?: boolean;
  }
): { ok: true; path: string; relationshipId: string } {
  const ensure = (n: string) => {
    if (!findTableFile(pbipPath, n)) {
      throw new Error(`Tabelle '${n}' nicht im Modell gefunden`);
    }
  };
  ensure(args.fromTable);
  ensure(args.toTable);
  const id = randomUUID();
  const block = [
    ``,
    `relationship ${id}`,
    `\tfromColumn: '${args.fromTable}'.'${args.fromColumn}'`,
    `\ttoColumn: '${args.toTable}'.'${args.toColumn}'`,
    args.crossFilteringBehavior
      ? `\tcrossFilteringBehavior: ${args.crossFilteringBehavior}`
      : "",
    args.isActive === false ? `\tisActive: false` : "",
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  const targetFile = relationshipsFilePath(pbipPath);
  const existing = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : "";
  const newContent = existing.replace(/\s*$/, "\n") + block + "\n";
  return { ok: true, path: backupAndWrite(targetFile, newContent), relationshipId: id };
}

export function addCalculatedColumn(
  pbipPath: string,
  args: {
    table: string;
    name: string;
    expression: string;
    dataType?: "int64" | "double" | "string" | "boolean" | "dateTime";
    formatString?: string;
    summarizeBy?: "none" | "sum" | "average" | "count" | "max" | "min";
  }
): { ok: true; path: string } {
  const file = findTableFile(pbipPath, args.table);
  if (!file) throw new Error(`Tabelle '${args.table}' nicht im Modell gefunden`);
  const block = findBlock(
    file.content,
    new RegExp(`^table\\s+(?:'${escapeRegex(args.table)}'|${escapeRegex(args.table)})\\b`)
  );
  if (!block) throw new Error(`Tabellen-Block in ${file.filePath} nicht parsbar`);
  const lines = file.content.split(/\r?\n/);
  const insertAt = block.end;
  const expr = args.expression.trim();
  if (expr.includes("\n")) {
    throw new Error(
      "Calculated-Column-Ausdrücke müssen einzeilig sein. Verwende für komplexere Logik eine Measure-Definition oder fasse den Ausdruck zusammen."
    );
  }
  const colName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name) ? args.name : `'${args.name.replace(/'/g, "''")}'`;
  const props: string[] = [];
  if (args.dataType) props.push(`\t\tdataType: ${args.dataType}`);
  props.push(`\t\tsummarizeBy: ${args.summarizeBy ?? "none"}`);
  if (args.formatString) props.push(`\t\tformatString: ${tmdlString(args.formatString)}`);
  const insert = ["", `\tcolumn ${colName} = ${expr}`, ...props, ""];
  lines.splice(insertAt, 0, ...insert);
  return { ok: true, path: backupAndWrite(file.filePath, joinBlock(lines)) };
}

export function addCalculatedTable(
  pbipPath: string,
  args: {
    name: string;
    expression: string;
    dataCategory?: "Time" | "Regular";
  }
): { ok: true; path: string; tableName: string } {
  if (findTableFile(pbipPath, args.name)) {
    throw new Error(`Tabelle '${args.name}' existiert bereits.`);
  }
  const expr = args.expression.trim();
  if (expr.includes("\n")) {
    throw new Error(
      "Calculated-Table-Ausdrücke müssen einzeilig sein (z.B. 'CALENDAR(DATE(2020,1,1), DATE(2030,12,31))' oder 'SUMMARIZE(...)'). Verwende für mehrzeilige Logik mehrere Schritte oder eine Measure."
    );
  }
  const d = discoverModel(pbipPath);
  const dataCat = args.dataCategory ? `\n\tdataCategory: ${args.dataCategory}\n` : "\n";
  const block = `
table '${args.name}'${dataCat}
\tpartition '${args.name}' = calculated
\t\tmode: import
\t\tsource = ${expr}
`;
  if (d.layout === "sharded") {
    const tablesDir = join(d.definitionDir, "tables");
    const target = existsSync(tablesDir)
      ? join(tablesDir, `${args.name}.tmdl`)
      : join(d.definitionDir, `${args.name}.tmdl`);
    return {
      ok: true,
      path: backupAndWrite(target, block.trimStart() + "\n"),
      tableName: args.name,
    };
  }
  const target = modelTmdlPath(pbipPath);
  const src = existsSync(target) ? readFileSync(target, "utf8") : "";
  return {
    ok: true,
    path: backupAndWrite(target, src.replace(/\s*$/, "\n") + block + "\n"),
    tableName: args.name,
  };
}

export function addDateTable(
  pbipPath: string,
  args?: { name?: string; startDate?: string; endDate?: string }
): { ok: true; path: string; tableName: string } {
  const name = args?.name ?? "Date";
  const start = args?.startDate ?? "DATE(2020,1,1)";
  const end = args?.endDate ?? "DATE(2030,12,31)";

  // Schon vorhanden?
  if (findTableFile(pbipPath, name)) {
    const existing = findTableFile(pbipPath, name);
    return { ok: true, path: existing!.filePath, tableName: name };
  }

  const d = discoverModel(pbipPath);
  // Kanonische PBI-Form: Single-Line-Partition mit CALENDAR(...) (liefert die
  // Date-Spalte) plus jede weitere Spalte als calculated column. Damit
  // brauchen wir keinen Triple-Backtick-Fence und keine ADDCOLUMNS-Konstrukte
  // im Partition-Body, die TMDL bei jeder Indentations-Ungenauigkeit als
  // "InvalidLineType" abweist.
  const block = `
table '${name}'
\tdataCategory: Time

\tcolumn Date
\t\tdataType: dateTime
\t\tisKey
\t\tsummarizeBy: none
\t\tsourceColumn: [Date]
\t\tformatString: "General Date"

\tcolumn Year = YEAR([Date])
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tformatString: "0"

\tcolumn Quarter = "Q" & FORMAT([Date], "Q")
\t\tdataType: string
\t\tsummarizeBy: none

\tcolumn Month = MONTH([Date])
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tformatString: "0"

\tcolumn MonthName = FORMAT([Date], "MMMM")
\t\tdataType: string
\t\tsummarizeBy: none

\tcolumn YearMonth = FORMAT([Date], "yyyy-MM")
\t\tdataType: string
\t\tsummarizeBy: none

\tpartition '${name}' = calculated
\t\tmode: import
\t\tsource = CALENDAR(${start}, ${end})
`;

  if (d.layout === "sharded") {
    // Eigene Datei in tables/<Name>.tmdl
    const tablesDir = join(d.definitionDir, "tables");
    if (!existsSync(tablesDir)) {
      // Fallback: in definitionDir schreiben
      return {
        ok: true,
        path: backupAndWrite(join(d.definitionDir, `${name}.tmdl`), block.trimStart() + "\n"),
        tableName: name,
      };
    }
    return {
      ok: true,
      path: backupAndWrite(join(tablesDir, `${name}.tmdl`), block.trimStart() + "\n"),
      tableName: name,
    };
  }

  // single-file: an model.tmdl anhängen
  const target = modelTmdlPath(pbipPath);
  const src = existsSync(target) ? readFileSync(target, "utf8") : "";
  return {
    ok: true,
    path: backupAndWrite(target, src.replace(/\s*$/, "\n") + block + "\n"),
    tableName: name,
  };
}

export function removeRelationship(pbipPath: string, id: string): { ok: boolean; path: string } {
  const d = discoverModel(pbipPath);
  if (d.layout === "none" || d.layout === "bim") {
    return { ok: false, path: d.definitionDir };
  }
  const re = new RegExp(
    `(?:^|\\n)relationship\\s+${escapeRegex(id)}[\\s\\S]*?(?=\\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\\b|\\s*$)`,
    "g"
  );
  for (const f of d.files) {
    if (re.test(f.content)) {
      return { ok: true, path: backupAndWrite(f.path, f.content.replace(re, "")) };
    }
    re.lastIndex = 0;
  }
  return { ok: false, path: d.definitionDir };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

