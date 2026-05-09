// Pragmatic TMDL editor: liest und schreibt model.tmdl direkt im PBIP-Projekt.
//
// Funktioniert über Text-Manipulation – kein vollständiger TMDL-Parser, sondern
// gezielte Inserts in bekannte Strukturen. Power BI Desktop liest die TMDL beim
// Laden des Projekts; nach Änderungen muss der User in PBI Desktop "Datei →
// Schließen ohne Speichern → erneut öffnen" oder Desktop neu starten.
//
// Erzeugt für jede Mutation einen .tmdl.bak-Snapshot, damit nichts unwiderruflich
// kaputtgeht.

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from "node:fs";
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
  isActive: boolean;
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

  // WICHTIG: hier werden ALLE Tabellen geparst, auch LocalDateTable_*
  // und DateTableTemplate_* (die Auto-Date-Tabellen, die PBI Desktop
  // selber pro dateTime-Spalte anlegt). Wenn wir die ausfiltern würden,
  // markiert fix_ambiguous_relationships die Auto-Date-Beziehungen als
  // „orphaned" und entfernt sie – dann zeigen die Variation-Properties
  // auf den dateTime-Spalten ins Leere und PBI öffnet das Projekt nicht
  // mehr. Filtern für die AI-User-Sicht passiert eine Schicht weiter
  // oben in builtin-tools.ts (read_pbip_metadata).

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
      isActive?: boolean;
    }>).map((r) => ({
      id: r.name ?? "",
      fromTable: r.fromTable ?? "",
      fromColumn: r.fromColumn ?? "",
      toTable: r.toTable ?? "",
      toColumn: r.toColumn ?? "",
      isActive: r.isActive !== false,
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
    // Auto-Date-Tabellen (LocalDateTable_*, DateTableTemplate_*) bleiben drin,
    // damit fix_ambiguous_relationships sie NICHT als orphan-Quelle interpretiert.
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
    relationships.push({ id, fromTable, fromColumn, toTable, toColumn, isActive: !/isActive:\s*false/.test(body) });
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

// Entfernt ALLE Measures mit dem gegebenen Namen aus einer Tabellen-TMDL-Datei.
// Line-by-line statt Regex, weil Regex über mehrzeilige Blöcke mit langen
// String-Literalen unzuverlässig ist (Issue: vorherige Implementierung hat
// Duplikate stehen lassen → PBI-Fehler "TMDL-Objekte können nicht
// zusammengeführt werden, weil beide die gleiche Eigenschaft expression
// deklarieren").
export function removeMeasure(
  pbipPath: string,
  tableName: string,
  measureName: string
): { ok: boolean; path: string; removedCount: number } {
  const file = findTableFile(pbipPath, tableName);
  if (!file) return { ok: false, path: pbipPath, removedCount: 0 };

  const lines = file.content.split(/\r?\n/);
  const out: string[] = [];
  let removed = 0;
  let skipping = false;
  let measureIndent = 0;
  // Erkennt eine measure-Zeile mit gegebenem Namen, optional mit/ohne Quotes.
  const headerRe = new RegExp(
    `^(\\s*)measure\\s+(?:'${escapeRegex(measureName)}'|${escapeRegex(measureName)})\\s*(?:=|$)`
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!skipping) {
      const m = line.match(headerRe);
      if (m) {
        // Beginn eines zu entfernenden Measure-Blocks
        skipping = true;
        measureIndent = m[1].length;
        removed++;
        continue;
      }
      out.push(line);
      continue;
    }
    // skipping == true: alle Folgezeilen mit größerer Einrückung gehören zum
    // Measure-Block. Eine leere Zeile beendet den Block NICHT (Properties
    // dürfen leere Zeilen dazwischen haben). Eine Zeile mit gleicher oder
    // kleinerer Einrückung als der Measure-Header beendet den Block.
    if (line.trim() === "") {
      // Leerzeilen innerhalb des Measure-Blocks droppen
      continue;
    }
    const lineIndent = line.match(/^\s*/)![0].length;
    if (lineIndent > measureIndent) {
      // Property-Zeile innerhalb des Measure-Blocks → droppen
      continue;
    }
    // Geschwister oder Top-Level → Measure-Block beendet, diese Zeile
    // wieder normal aufnehmen
    skipping = false;
    out.push(line);
  }

  if (removed === 0) {
    return { ok: false, path: file.filePath, removedCount: 0 };
  }
  // Doppelte Leerzeilen normalisieren, die durch das Skippen entstehen
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    ok: true,
    path: backupAndWrite(file.filePath, cleaned),
    removedCount: removed,
  };
}

// Wandelt ein HTML-Dokument in einen DAX-String-Literal um, der
// 1) auf eine Zeile passt (TMDL-Parser pingelig bei Multi-Line ohne Fence),
// 2) keine Zeichen enthält, die DAX/TMDL falsch interpretiert.
//
// Verfahren:
//  - alle Whitespace-Sequenzen (Newline, Tab, mehrfach-Space) → einzelnes
//    Leerzeichen kollabieren (zwischen HTML-Tags ist Whitespace semantikfrei)
//  - Doppel-Quotes verdoppeln (DAX-String-Escape)
//  - Control-Characters außer Tab/Newline (die schon collapsed sind) entfernen
export function htmlToDaxLiteral(html: string): string {
  const cleaned = html
    // Control-Chars (außer \t \n \r) die manche HTML-Editoren produzieren
    .replace(/[ --]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const escaped = cleaned.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function addMeasure(
  pbipPath: string,
  args: {
    table: string;
    name: string;
    expression: string;
    formatString?: string;
    displayFolder?: string;
    replace?: boolean;
  }
): { ok: true; path: string; replaced?: boolean; removedCount?: number } {
  let replaced = false;
  let removedCount = 0;
  if (args.replace) {
    // Wenn schon Measure(s) mit dem Namen existieren, alle vorher entfernen.
    // Loop falls aus irgendeinem Grund mehrfach Aufruf nötig ist.
    try {
      for (let i = 0; i < 5; i++) {
        const r = removeMeasure(pbipPath, args.table, args.name);
        if (!r.ok) break;
        removedCount += r.removedCount;
        replaced = true;
      }
    } catch {
      /* tolerate */
    }
  }
  const file = findTableFile(pbipPath, args.table);
  if (!file) {
    let availableTables = "(unbekannt)";
    try {
      availableTables = listModel(pbipPath).tables.map((t) => t.name).join(", ") || "(keine)";
    } catch {
      /* ignore */
    }
    throw new Error(
      `Tabelle '${args.table}' nicht im Modell gefunden. Vorhandene Tabellen: ${availableTables}. ` +
        `Rufe list_model auf, um die echten Tabellennamen zu sehen.`
    );
  }
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
  return {
    ok: true,
    path: backupAndWrite(file.filePath, joinBlock(lines)),
    ...(replaced ? { replaced: true, removedCount } : {}),
  };
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
): {
  ok: true;
  path: string;
  relationshipId: string;
  alreadyExisted?: boolean;
  forcedInactive?: boolean;
  forcedInactiveBecauseOf?: string;
} {
  // Spaltenexistenz validieren – verhindert die häufigste Fehlerklasse:
  // KI halluziniert Spaltennamen (z.B. "OrderID" wo die echte Spalte
  // "[id]" oder "Order Number" heißt). Die Beziehung würde sonst stumm
  // geschrieben, beim Reload kracht PBI Desktop. Lieber hier hart abbrechen
  // mit einer Liste der tatsächlichen Spalten, damit die KI nachfragen
  // oder direkt korrigieren kann.
  let snapshot;
  try {
    snapshot = listModel(pbipPath);
  } catch {
    snapshot = { tables: [], relationships: [] };
  }
  const findCol = (tableName: string, columnName: string) => {
    const tbl = snapshot.tables.find((t) => t.name === tableName);
    if (!tbl) {
      throw new Error(
        `Tabelle '${tableName}' nicht im Modell gefunden. ` +
          `Vorhandene Tabellen: ${snapshot.tables.map((t) => t.name).join(", ") || "(keine)"}.`
      );
    }
    if (!tbl.columns.find((c) => c.name === columnName)) {
      throw new Error(
        `Spalte '${columnName}' existiert nicht in Tabelle '${tableName}'. ` +
          `Vorhandene Spalten: ${tbl.columns.map((c) => c.name).join(", ") || "(keine)"}. ` +
          `Rufe list_model erneut auf, um die echten Spaltennamen zu sehen, bevor du eine Beziehung anlegst.`
      );
    }
  };
  if (snapshot.tables.length > 0) {
    findCol(args.fromTable, args.fromColumn);
    findCol(args.toTable, args.toColumn);
  } else {
    // Fallback: zumindest Tabellen-Existenz prüfen
    const ensure = (n: string) => {
      if (!findTableFile(pbipPath, n)) {
        throw new Error(`Tabelle '${n}' nicht im Modell gefunden`);
      }
    };
    ensure(args.fromTable);
    ensure(args.toTable);
  }

  // Beziehungs-Logik:
  //  1) exaktes Spaltenpaar schon da → skip
  //  2) GLEICHES Tabellenpaar mit anderen Spalten + dort schon eine
  //     active=true → die neue MUSS isActive: false sein (Power BI
  //     erlaubt nur EINE active relationship pro Tabellenpaar, sonst
  //     PFE_XL_USERELATIONSHIP_AMBIGUOUS_PATH).
  let forcedInactive = false;
  let inactivatedBecauseOf: string | null = null;
  try {
    const existing = snapshot.relationships;
    const samePair = existing.find(
      (r) =>
        (r.fromTable === args.fromTable &&
          r.fromColumn === args.fromColumn &&
          r.toTable === args.toTable &&
          r.toColumn === args.toColumn) ||
        (r.fromTable === args.toTable &&
          r.fromColumn === args.toColumn &&
          r.toTable === args.fromTable &&
          r.toColumn === args.fromColumn)
    );
    if (samePair) {
      return {
        ok: true,
        path: relationshipsFilePath(pbipPath),
        relationshipId: samePair.id,
        alreadyExisted: true,
      };
    }
    const sameTablePair = existing.filter(
      (r) =>
        (r.fromTable === args.fromTable && r.toTable === args.toTable) ||
        (r.fromTable === args.toTable && r.toTable === args.fromTable)
    );
    const activeBetween = sameTablePair.find((r) => r.isActive);
    const wantsActive = args.isActive !== false;
    if (activeBetween && wantsActive) {
      forcedInactive = true;
      inactivatedBecauseOf =
        `'${activeBetween.fromTable}'.'${activeBetween.fromColumn}' → ` +
        `'${activeBetween.toTable}'.'${activeBetween.toColumn}'`;
      args = { ...args, isActive: false };
    }
  } catch {
    /* listModel-Fehler tolerieren – dann wird halt geschrieben */
  }

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
  const existingContent = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : "";
  const newContent = existingContent.replace(/\s*$/, "\n") + block + "\n";
  return {
    ok: true,
    path: backupAndWrite(targetFile, newContent),
    relationshipId: id,
    ...(forcedInactive
      ? { forcedInactive: true, forcedInactiveBecauseOf: inactivatedBecauseOf ?? undefined }
      : {}),
  };
}

// Geht alle Beziehungen durch und stellt sicher, dass pro Tabellenpaar
// maximal EINE active Beziehung existiert. Mehrfach-active werden auf
// inactive gesetzt; exakte Duplikate (gleiches Spaltenpaar) gelöscht.
// Stellt für jede .tmdl.bak im SemanticModel-Verzeichnis den letzten
// Vor-viBI-Stand der entsprechenden .tmdl wieder her. Der ehemalige
// .tmdl-Inhalt wird sicherheitshalber als .tmdl.before-restore abgelegt.
export function restoreTmdlBackups(pbipPath: string): {
  ok: boolean;
  restoredCount: number;
  restored: string[];
} {
  const d = discoverModel(pbipPath);
  if (d.layout === "none" || d.layout === "bim") {
    return { ok: false, restoredCount: 0, restored: [] };
  }
  const restored: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".tmdl.bak")) {
        const target = p.replace(/\.tmdl\.bak$/, ".tmdl");
        try {
          if (existsSync(target)) {
            copyFileSync(target, target + ".before-restore");
          }
          copyFileSync(p, target);
          restored.push(target);
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(d.semanticModelDir);
  return { ok: true, restoredCount: restored.length, restored };
}

export function fixAmbiguousRelationships(pbipPath: string): {
  ok: boolean;
  path: string;
  deactivatedCount: number;
  removedCount: number;
  brokenRemovedCount: number;
  log: string[];
} {
  const d = discoverModel(pbipPath);
  if (d.layout === "none" || d.layout === "bim") {
    return {
      ok: false,
      path: d.definitionDir,
      deactivatedCount: 0,
      removedCount: 0,
      brokenRemovedCount: 0,
      log: [],
    };
  }
  const model = listModel(pbipPath);
  const log: string[] = [];
  let deactivated = 0;
  let removed = 0;
  let brokenRemoved = 0;

  // Schritt 0: Orphaned Beziehungen finden (referenzieren nicht-existente
  // Tabellen oder Spalten). Diese werden komplett entfernt.
  const tableMap = new Map(model.tables.map((t) => [t.name, t]));
  const orphaned: ListedRelationship[] = [];
  for (const r of model.relationships) {
    const fromT = tableMap.get(r.fromTable);
    const toT = tableMap.get(r.toTable);
    const fromOk = fromT && fromT.columns.some((c) => c.name === r.fromColumn);
    const toOk = toT && toT.columns.some((c) => c.name === r.toColumn);
    if (!fromOk || !toOk) orphaned.push(r);
  }

  // Schritt 1: exakte Duplikate finden (gleiche Spaltenpaare) – aber nur
  // unter den Beziehungen, die noch nicht als orphaned markiert sind.
  const seenPair = new Map<string, ListedRelationship>();
  const exactDups: ListedRelationship[] = [];
  for (const r of model.relationships) {
    if (orphaned.includes(r)) continue;
    const key = [
      [r.fromTable, r.fromColumn].join("|"),
      [r.toTable, r.toColumn].join("|"),
    ]
      .sort()
      .join("=");
    const prev = seenPair.get(key);
    if (prev) exactDups.push(r);
    else seenPair.set(key, r);
  }
  // Schritt 2: pro Tabellenpaar zweite-und-weitere active → inactive
  const activePerPair = new Map<string, ListedRelationship>();
  const toDeactivate: ListedRelationship[] = [];
  for (const r of model.relationships) {
    if (orphaned.includes(r) || exactDups.includes(r)) continue;
    if (!r.isActive) continue;
    const tablesKey = [r.fromTable, r.toTable].sort().join("=");
    if (activePerPair.has(tablesKey)) {
      toDeactivate.push(r);
    } else {
      activePerPair.set(tablesKey, r);
    }
  }

  // Schritt 3: alle betroffenen TMDL-Dateien anpassen
  for (const f of d.files) {
    let content = f.content;
    let changed = false;
    for (const orph of orphaned) {
      const re = new RegExp(
        `(?:^|\\n)relationship\\s+${escapeRegex(orph.id)}[\\s\\S]*?(?=\\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\\b|\\s*$)`,
        "g"
      );
      if (re.test(content)) {
        content = content.replace(re, "");
        log.push(
          `✗ Orphaned Beziehung ${orph.id} entfernt (${orph.fromTable}.${orph.fromColumn} → ${orph.toTable}.${orph.toColumn} – Spalte/Tabelle existiert nicht)`
        );
        brokenRemoved++;
        changed = true;
      }
    }
    for (const dup of exactDups) {
      const re = new RegExp(
        `(?:^|\\n)relationship\\s+${escapeRegex(dup.id)}[\\s\\S]*?(?=\\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\\b|\\s*$)`,
        "g"
      );
      if (re.test(content)) {
        content = content.replace(re, "");
        log.push(`✗ Doppelte Beziehung ${dup.id} (${dup.fromTable}.${dup.fromColumn} → ${dup.toTable}.${dup.toColumn}) entfernt`);
        removed++;
        changed = true;
      }
    }
    for (const inact of toDeactivate) {
      // Block des Relationships finden, isActive: false hinzufügen falls noch nicht da
      const re = new RegExp(
        `((?:^|\\n)relationship\\s+${escapeRegex(inact.id)}[\\s\\S]*?)(?=\\n(?:model|table|relationship|role|perspective|expression|dataSource|annotation)\\b|\\s*$)`,
        "g"
      );
      content = content.replace(re, (block) => {
        if (/isActive:\s*false/.test(block)) return block;
        log.push(
          `⚠ ${inact.fromTable}.${inact.fromColumn} → ${inact.toTable}.${inact.toColumn} auf inactive gesetzt (zweite Beziehung zwischen ${inact.fromTable} und ${inact.toTable})`
        );
        deactivated++;
        changed = true;
        return block.replace(/\s*$/, "") + `\n\tisActive: false\n`;
      });
    }
    if (changed) backupAndWrite(f.path, content);
  }

  return {
    ok: true,
    path: d.definitionDir,
    deactivatedCount: deactivated,
    removedCount: removed,
    brokenRemovedCount: brokenRemoved,
    log,
  };
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
  if (!file) {
    let availableTables = "(unbekannt)";
    try {
      availableTables = listModel(pbipPath).tables.map((t) => t.name).join(", ") || "(keine)";
    } catch {
      /* ignore */
    }
    throw new Error(
      `Tabelle '${args.table}' nicht gefunden. Vorhandene Tabellen: ${availableTables}.`
    );
  }
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
  // Power BI Desktop schreibt Datumstabellen kanonisch so: reguläre Columns
  // mit sourceColumn: [X], ADDCOLUMNS(...) als Partition-Source als
  // indented multi-line (KEIN Triple-Backtick-Fence – der ist für M, nicht
  // für DAX). Indentation der Expression-Zeilen MUSS tiefer sein als die
  // `source =`-Zeile, sonst beendet der Parser den Block zu früh.
  const block = `
table '${name}'
\tdataCategory: Time

\tcolumn Date
\t\tdataType: dateTime
\t\tisKey
\t\tsummarizeBy: none
\t\tsourceColumn: [Date]
\t\tformatString: General Date

\tcolumn Year
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tsourceColumn: [Year]
\t\tformatString: 0

\tcolumn Quarter
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [Quarter]

\tcolumn Month
\t\tdataType: int64
\t\tsummarizeBy: none
\t\tsourceColumn: [Month]
\t\tformatString: 0

\tcolumn MonthName
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [MonthName]

\tcolumn YearMonth
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: [YearMonth]

\tpartition '${name}' = calculated
\t\tmode: import
\t\tsource =
\t\t\t\tADDCOLUMNS(
\t\t\t\t\tCALENDAR(${start}, ${end}),
\t\t\t\t\t"Year", YEAR([Date]),
\t\t\t\t\t"Quarter", "Q" & FORMAT([Date], "Q"),
\t\t\t\t\t"Month", MONTH([Date]),
\t\t\t\t\t"MonthName", FORMAT([Date], "MMMM"),
\t\t\t\t\t"YearMonth", FORMAT([Date], "yyyy-MM")
\t\t\t\t)
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

