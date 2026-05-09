// PBIP (Power BI Project) writer with CI-aware report theme.
// Layout PowerBI Desktop expects when "Save as project" is enabled:
//
//   <Project>/
//     <Project>.pbip
//     <Project>.SemanticModel/
//       definition.pbism
//       definition/model.tmdl
//     <Project>.Report/
//       definition.pbir
//       report.json
//       StaticResources/RegisteredResources/Theme.json

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { concatenatedTmdl, discoverModel } from "./tmdl-discovery.js";

interface Column {
  name: string;
  dataType: "string" | "int64" | "double" | "boolean" | "dateTime";
}
interface Table {
  name: string;
  columns: Column[];
  rows?: Record<string, unknown>[];
}
interface CIConfig {
  logoDataUrl?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fontFamily: string;
}
interface Project {
  name: string;
  fileName?: string;
  goal?: string;
  ci?: CIConfig;
  kpis?: string[];
  tables?: Table[];
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

function tmdlForTable(t: Table): string {
  const cols = t.columns
    .map(
      (c) =>
        `\tcolumn '${c.name}'\n\t\tdataType: ${c.dataType}\n\t\tsourceColumn: ${c.name}`
    )
    .join("\n\n");

  const rows = (t.rows ?? []).map((r) => {
    const fields = t.columns
      .map((c) => {
        const v = r[c.name];
        if (v === null || v === undefined) return `${c.name} = null`;
        if (typeof v === "number" || typeof v === "boolean") return `${c.name} = ${v}`;
        return `${c.name} = "${String(v).replace(/"/g, '""')}"`;
      })
      .join(", ");
    return `[${fields}]`;
  });

  const mExpr = `let
\tSource = #table(
\t\ttype table [${t.columns.map((c) => `${c.name}=text`).join(", ")}],
\t\t{${rows.join(", ")}}
\t)
in
\tSource`;

  const fence = "```";
  return (
    `table '${t.name}'\n${cols}\n\n` +
    `\tpartition '${t.name}-Partition' = m\n` +
    `\t\tmode: import\n` +
    `\t\tsource = ${fence}\n${mExpr}\n${fence}\n`
  );
}

// Default-TMDL beim Anlegen eines Projekts: kalkulierte Datumstabelle in
// kanonischer Power-BI-Form (regular columns mit sourceColumn, ADDCOLUMNS
// als indented multi-line ohne Fence – das ist genau das Format, das PBI
// Desktop selbst beim "New table → Date table" erzeugt).
function defaultDateTableTmdl(): string {
  return `table 'Date'
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

\tpartition 'Date' = calculated
\t\tmode: import
\t\tsource =
\t\t\t\tADDCOLUMNS(
\t\t\t\t\tCALENDAR(DATE(2020,1,1), DATE(2030,12,31)),
\t\t\t\t\t"Year", YEAR([Date]),
\t\t\t\t\t"Quarter", "Q" & FORMAT([Date], "Q"),
\t\t\t\t\t"Month", MONTH([Date]),
\t\t\t\t\t"MonthName", FORMAT([Date], "MMMM"),
\t\t\t\t\t"YearMonth", FORMAT([Date], "yyyy-MM")
\t\t\t\t)
`;
}

// Page dimensions (PowerBI Standard 16:9)
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 720;

// VisualType-Identifier des "HTML Content" Custom Visuals von html-content.com
// (Daniel Marsh-Patrick). Falls der User eine andere HTML-Visual-Variante
// installiert hat, kann er das per HTML_VISUAL_TYPE Env-Var überschreiben.
const HTML_VISUAL_TYPE = process.env.HTML_VISUAL_TYPE ?? "HTMLContent451CCA94144C49ECB7BCDC4E5E7E1A4D";

// Erzeugt einen page-fillenden Visual-Container für das HTML-Content-Visual,
// dessen "Values"-Feld an das angegebene Measure gebunden wird.
//
// Die report.json-Form ist Legacy-PBIX-kompatibel. PBI Desktop konvertiert das
// beim Speichern ggf. ins sharded Format, behält aber Position + Bindings bei.
export function buildHtmlContentVisualContainer(args: {
  measureTable: string;
  measureName: string;
  visualType?: string;
}) {
  const visualType = args.visualType ?? HTML_VISUAL_TYPE;
  const tableAlias = args.measureTable.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 4) || "t";
  const queryName = `${args.measureTable}.${args.measureName}`;
  // PBI-Query, die genau die Measure als einzigen Datenpunkt selektiert.
  const prototypeQuery = {
    Version: 2,
    From: [{ Name: tableAlias, Entity: args.measureTable, Type: 0 }],
    Select: [
      {
        Measure: {
          Expression: { SourceRef: { Source: tableAlias } },
          Property: args.measureName,
        },
        Name: queryName,
      },
    ],
  };
  return {
    x: 0,
    y: 0,
    z: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    config: JSON.stringify({
      name: "vibiHtmlContent",
      layouts: [
        { id: 0, position: { x: 0, y: 0, z: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT } },
      ],
      singleVisual: {
        visualType,
        projections: {
          Values: [{ queryRef: queryName, active: true }],
        },
        prototypeQuery,
        drillFilterOtherVisuals: true,
        objects: {},
      },
    }),
    filters: "[]",
    query: JSON.stringify({
      Commands: [{ SemanticQueryDataShapeCommand: { Query: prototypeQuery, Binding: { Primary: { Groupings: [{ Projections: [0] }] }, DataReduction: { DataVolume: 4, Primary: { Top: {} } }, Version: 1 } } }],
    }),
    dataTransforms: JSON.stringify({
      objects: {},
      projectionOrdering: { Values: [0] },
      queryMetadata: {
        Select: [{ Restatement: queryName, Name: queryName, Type: 1 }],
      },
      visualElements: [{ DataRoles: [{ Name: "Values", Projection: 0, isActive: true }] }],
      selects: [{ displayName: queryName, queryName, type: { underlyingType: 1, category: null } }],
    }),
  };
}

function buildReportJson(opts: {
  withHtmlPlaceholder?: boolean;
  htmlContent?: string;
  measureTable?: string;
  measureName?: string;
}) {
  // Page-fillendes "HTML Content"-Visual von html-content.com mit der
  // Dashboard-HTML-Measure als Value-Binding. Wenn kein Measure-Name übergeben
  // wurde, wird der Bereich leer gelassen – nur das nackte Visual fürs initiale
  // PBIP. embed_full_page_html ruft buildReportJson später mit measureName auf.
  const measureTable = opts.measureTable;
  const measureName = opts.measureName;
  const visualContainers =
    measureTable && measureName
      ? [buildHtmlContentVisualContainer({ measureTable, measureName })]
      : [];

  return {
    config: '{"version":"5.43","themeCollection":{"customTheme":{"name":"viBI"}}}',
    layoutOptimization: 0,
    sections: [
      {
        name: "Page1",
        displayName: "Übersicht",
        displayOption: 1,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        visualContainers,
      },
    ],
  };
}

function ciToTheme(name: string, ci?: CIConfig) {
  const c = ci?.colors;
  return {
    name: `${name} Theme`,
    dataColors: c
      ? [c.primary, c.accent, c.secondary, c.text, c.primary, c.accent]
      : ["#0078D4", "#F2C811", "#1F2937", "#111827"],
    background: c?.background ?? "#FFFFFF",
    foreground: c?.text ?? "#111827",
    tableAccent: c?.accent ?? "#F2C811",
  };
}

export function writePBIP(projectDir: string, project: Project): string {
  ensureDir(projectDir);
  const name = project.name;
  const semDir = join(projectDir, `${name}.SemanticModel`);
  const semDefDir = join(semDir, "definition");
  const repDir = join(projectDir, `${name}.Report`);
  const themeDir = join(repDir, "StaticResources", "RegisteredResources");
  ensureDir(semDefDir);
  ensureDir(themeDir);

  // .pbip pointer file
  writeFileSync(
    join(projectDir, `${name}.pbip`),
    JSON.stringify(
      {
        version: "1.0",
        artifacts: [{ report: { path: `${name}.Report` } }],
        settings: { enableAutoRecovery: true },
      },
      null,
      2
    )
  );

  // SemanticModel definition.pbism
  writeFileSync(
    join(semDir, "definition.pbism"),
    JSON.stringify({ version: "4.0", settings: {} }, null, 2)
  );

  // Default-Modell: KEINE Stub-Daten-Tabelle. Stattdessen direkt eine
  // kalkulierte Datumstabelle, weil die in 95% aller Bericht-Use-Cases
  // benötigt wird. Custom-Tables (project.tables) werden weiterhin direkt
  // ausgeschrieben, falls jemand sie programmatisch übergibt.
  const customTables: Table[] = project.tables ?? [];
  const tableSection = customTables.length
    ? customTables.map(tmdlForTable).join("\n\n")
    : defaultDateTableTmdl();

  const tmdl =
    `model Model\n\tculture: en-US\n\tdefaultPowerBIDataSourceVersion: powerBI_V3\n\n` +
    tableSection;
  writeFileSync(join(semDefDir, "model.tmdl"), tmdl);

  // Report definition.pbir + report.json + theme
  writeFileSync(
    join(repDir, "definition.pbir"),
    JSON.stringify(
      {
        version: "1.0",
        datasetReference: { byPath: { path: `../${name}.SemanticModel` } },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(repDir, "report.json"),
    JSON.stringify(buildReportJson({ withHtmlPlaceholder: true }), null, 2)
  );

  writeFileSync(
    join(themeDir, "Theme.json"),
    JSON.stringify(ciToTheme(name, project.ci), null, 2)
  );

  // viBI metadata sidecar (so we can re-load CI/KPIs later)
  writeFileSync(
    join(projectDir, ".vibi.json"),
    JSON.stringify(
      {
        name,
        fileName: project.fileName,
        goal: project.goal,
        kpis: project.kpis ?? [],
        ci: project.ci,
      },
      null,
      2
    )
  );

  return join(projectDir, `${name}.pbip`);
}

// Schreibt die report.json so, dass auf der ersten Seite das HTML-Content-
// Visual page-fillend platziert ist und dessen "Values"-Feld an die Measure
// gebunden ist (Default: 'Date'.'Dashboard HTML'). HTML selbst lebt in der
// Measure (per addMeasure), das Visual rendert es.
export function applyFullPageHTML(
  pbipPath: string,
  _html: string,
  opts?: { measureTable?: string; measureName?: string; visualType?: string }
): string {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const reportJsonPath = join(projectDir, `${projName}.Report`, "report.json");
  if (!existsSync(reportJsonPath)) {
    throw new Error(`report.json nicht gefunden unter ${reportJsonPath}`);
  }
  writeFileSync(
    reportJsonPath,
    JSON.stringify(
      buildReportJson({
        measureTable: opts?.measureTable ?? "Date",
        measureName: opts?.measureName ?? "Dashboard HTML",
      }),
      null,
      2
    )
  );
  return reportJsonPath;
}

export function readMetadata(pbipPath: string): {
  tables: { name: string; columns: { name: string; dataType: string }[] }[];
  layout?: string;
} {
  const d = discoverModel(pbipPath);

  // Legacy .bim → JSON parse
  if (d.layout === "bim" && d.bimJson) {
    const json = d.bimJson as { model?: { tables?: Array<{ name: string; columns?: Array<{ name: string; dataType?: string }> }> } };
    const m = json.model ?? json;
    const tables = ((m as { tables?: Array<{ name: string; columns?: Array<{ name: string; dataType?: string }> }> }).tables ?? [])
      .filter((t) => !t.name.startsWith("DateTableTemplate") && !t.name.startsWith("LocalDateTable"))
      .map((t) => ({
        name: t.name,
        columns: (t.columns ?? [])
          .filter((c) => !c.name.startsWith("RowNumber-"))
          .map((c) => ({ name: c.name, dataType: c.dataType ?? "unknown" })),
      }));
    return { tables, layout: d.layout };
  }

  if (d.layout === "none") return { tables: [], layout: d.layout };

  // TMDL kann sowohl in einer Datei (viBI's writePBIP) als auch zerteilt
  // (PBI Desktop's Speicher-Format) vorliegen. concatenatedTmdl klebt alles
  // zusammen, damit ein einziger Pass über alle Tabellen geht.
  const txt = concatenatedTmdl(d);
  // Tabellen-Header: `table 'Name'` ODER `table Name`
  const tableRegex = /(?:^|\n)table\s+(?:'([^']+)'|(\S+))([\s\S]*?)(?=\ntable\s+(?:'[^']+'|\S+)|\n### __VIBI_FILE__|$)/g;
  const colRegex = /column\s+(?:'([^']+)'|(\S+))[\s\S]*?dataType:\s*(\w+)/g;
  const tables: { name: string; columns: { name: string; dataType: string }[] }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(txt))) {
    const name = m[1] ?? m[2];
    const body = m[3];
    const cols: { name: string; dataType: string }[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = colRegex.exec(body))) {
      const colName = cm[1] ?? cm[2];
      if (colName.startsWith("RowNumber-")) continue;
      cols.push({ name: colName, dataType: cm[3] });
    }
    if (!name.startsWith("DateTableTemplate") && !name.startsWith("LocalDateTable")) {
      tables.push({ name, columns: cols });
    }
  }
  return { tables, layout: d.layout };
}
