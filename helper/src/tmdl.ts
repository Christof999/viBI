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

function tmdlPath(pbipPath: string): string {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  return join(projectDir, `${projName}.SemanticModel`, "definition", "model.tmdl");
}

function read(pbipPath: string): string {
  const p = tmdlPath(pbipPath);
  if (!existsSync(p)) throw new Error(`model.tmdl nicht gefunden: ${p}`);
  return readFileSync(p, "utf8");
}

function write(pbipPath: string, content: string): string {
  const p = tmdlPath(pbipPath);
  if (existsSync(p)) {
    try {
      copyFileSync(p, `${p}.bak`);
    } catch {
      /* best-effort backup */
    }
  }
  writeFileSync(p, content, "utf8");
  return p;
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
  tables: ListedTable[];
  relationships: ListedRelationship[];
} {
  const src = read(pbipPath);
  const tables: ListedTable[] = [];
  const tableRe = /^table\s+(?:'([^']+)'|(\S+))/gm;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(src))) {
    const name = match[1] ?? match[2];
    const block = findBlock(src, new RegExp(`^table\\s+(?:'${escapeRegex(name)}'|${escapeRegex(name)})\\b`));
    if (!block) continue;
    const body = src.split(/\r?\n/).slice(block.start, block.end).join("\n");
    const cols: { name: string; dataType: string }[] = [];
    const colRe = /column\s+(?:'([^']+)'|(\S+))[\s\S]*?dataType:\s*(\w+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = colRe.exec(body))) {
      cols.push({ name: cm[1] ?? cm[2], dataType: cm[3] });
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
  const relRe = /^relationship\s+(\S+)\s*\n([\s\S]*?)(?=\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\b|\s*$)/gm;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(src))) {
    const id = rm[1];
    const body = rm[2];
    const fromTable = body.match(/fromTable:\s*(\S+)/)?.[1] ?? "";
    const fromColumn = body.match(/fromColumn:\s*(\S+)/)?.[1] ?? "";
    const toTable = body.match(/toTable:\s*(\S+)/)?.[1] ?? "";
    const toColumn = body.match(/toColumn:\s*(\S+)/)?.[1] ?? "";
    relationships.push({ id, fromTable, fromColumn, toTable, toColumn });
  }

  return { pbipPath, tables, relationships };
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
): { ok: true; path: string; warning?: string } {
  const src = read(pbipPath);
  const table = args.table;
  const block = findBlock(src, new RegExp(`^table\\s+(?:'${escapeRegex(table)}'|${escapeRegex(table)})\\b`));
  if (!block) throw new Error(`Tabelle '${table}' nicht in TMDL gefunden`);
  const lines = src.split(/\r?\n/);
  // Insert vor dem Ende des Table-Blocks
  const insertAt = block.end;
  const expr = args.expression.includes("\n")
    ? args.expression
        .split(/\r?\n/)
        .map((l) => `\t\t${l}`)
        .join("\n")
    : `\t\t${args.expression}`;
  const lines2 = [
    "",
    `\tmeasure '${args.name}' =`,
    expr,
    args.formatString ? `\t\tformatString: ${quoteIfNeeded(args.formatString)}` : "",
    args.displayFolder ? `\t\tdisplayFolder: ${quoteIfNeeded(args.displayFolder)}` : "",
    "",
  ].filter(Boolean);
  lines.splice(insertAt, 0, ...lines2);
  return { ok: true, path: write(pbipPath, joinBlock(lines)) };
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
  const src = read(pbipPath);
  // Existieren beide Tabellen?
  const ensureTable = (n: string) => {
    if (!new RegExp(`^table\\s+(?:'${escapeRegex(n)}'|${escapeRegex(n)})\\b`, "m").test(src)) {
      throw new Error(`Tabelle '${n}' nicht in TMDL gefunden`);
    }
  };
  ensureTable(args.fromTable);
  ensureTable(args.toTable);
  const id = randomUUID();
  const block = [
    ``,
    `relationship ${id}`,
    `\tfromColumn: ${args.fromTable}.${args.fromColumn}`,
    `\ttoColumn: ${args.toTable}.${args.toColumn}`,
    args.crossFilteringBehavior
      ? `\tcrossFilteringBehavior: ${args.crossFilteringBehavior}`
      : "",
    args.isActive === false ? `\tisActive: false` : "",
    ``,
  ]
    .filter(Boolean)
    .join("\n");
  // Anhängen am Ende der Datei
  const newSrc = src.replace(/\s*$/, "\n") + block + "\n";
  return { ok: true, path: write(pbipPath, newSrc), relationshipId: id };
}

export function addDateTable(
  pbipPath: string,
  args?: { name?: string; startDate?: string; endDate?: string }
): { ok: true; path: string; tableName: string } {
  const name = args?.name ?? "Date";
  const start = args?.startDate ?? "DATE(2020,1,1)";
  const end = args?.endDate ?? "DATE(2030,12,31)";
  const src = read(pbipPath);
  if (new RegExp(`^table\\s+(?:'${escapeRegex(name)}'|${escapeRegex(name)})\\b`, "m").test(src)) {
    return { ok: true, path: tmdlPath(pbipPath), tableName: name };
  }
  const block = `

table '${name}'
\tdataCategory: Time

\tcolumn 'Date'
\t\tdataType: dateTime
\t\tisKey
\t\tsummarizeBy: none
\t\tsourceColumn: [Date]

\tcolumn 'Year'
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tsourceColumn: [Year]

\tcolumn 'Quarter'
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [Quarter]

\tcolumn 'Month'
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tsourceColumn: [Month]

\tcolumn 'MonthName'
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [MonthName]

\tcolumn 'YearMonth'
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [YearMonth]

\tpartition '${name}-Partition' = calculated
\t\tmode: import
\t\tsource = ADDCOLUMNS(
\t\t\tCALENDAR(${start}, ${end}),
\t\t\t"Year", YEAR([Date]),
\t\t\t"Quarter", "Q" & FORMAT([Date], "Q"),
\t\t\t"Month", MONTH([Date]),
\t\t\t"MonthName", FORMAT([Date], "MMMM"),
\t\t\t"YearMonth", FORMAT([Date], "YYYY-MM")
\t\t)
`;
  const newSrc = src.replace(/\s*$/, "\n") + block + "\n";
  return { ok: true, path: write(pbipPath, newSrc), tableName: name };
}

export function removeRelationship(pbipPath: string, id: string): { ok: boolean; path: string } {
  const src = read(pbipPath);
  const re = new RegExp(
    `\\nrelationship\\s+${escapeRegex(id)}[\\s\\S]*?(?=\\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\\b|\\s*$)`,
    "g"
  );
  if (!re.test(src)) return { ok: false, path: tmdlPath(pbipPath) };
  return { ok: true, path: write(pbipPath, src.replace(re, "")) };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteIfNeeded(s: string): string {
  // TMDL erlaubt einige Werte ohne Quotes. Sicherer: in Quotes.
  return s.includes('"') ? `'${s.replace(/'/g, "''")}'` : `"${s}"`;
}
