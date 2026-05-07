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

function defaultStarterTable(name: string): Table {
  return {
    name: "Sales",
    columns: [
      { name: "Date", dataType: "dateTime" },
      { name: "Region", dataType: "string" },
      { name: name || "Revenue", dataType: "double" },
    ],
    rows: [
      { Date: "2026-01-01", Region: "EU", [name || "Revenue"]: 12450.5 },
      { Date: "2026-01-02", Region: "US", [name || "Revenue"]: 9870.0 },
      { Date: "2026-01-03", Region: "APAC", [name || "Revenue"]: 5432.1 },
    ],
  };
}

// Page dimensions (PowerBI Standard 16:9)
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 720;

function buildReportJson(opts: {
  withHtmlPlaceholder?: boolean;
  htmlContent?: string;
}) {
  const html =
    opts.htmlContent ??
    (opts.withHtmlPlaceholder
      ? '<div style="padding:24px;font-family:Segoe UI,system-ui,sans-serif">Bericht wird in viBI gestaltet.</div>'
      : "");
  // Single full-page HTML visual covering the entire canvas.
  // Uses the public "HTML Content" custom visual (CWVHTMLVIEWER1709477497034).
  const visualContainers = html
    ? [
        {
          x: 0,
          y: 0,
          z: 0,
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          config: JSON.stringify({
            name: "vibiFullPage",
            layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT } }],
            singleVisual: {
              visualType: "CWVHTMLVIEWER1709477497034",
              objects: {
                contentFormatting: [
                  {
                    properties: {
                      htmlContent: { expr: { Literal: { Value: JSON.stringify(html) } } },
                    },
                  },
                ],
              },
              drillFilterOtherVisuals: true,
            },
          }),
        },
      ]
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

  // model.tmdl with at least one starter table per KPI (or default)
  const tables: Table[] =
    project.tables && project.tables.length
      ? project.tables
      : (project.kpis?.length
          ? project.kpis.slice(0, 1).map((k) => defaultStarterTable(k))
          : [defaultStarterTable("Revenue")]);

  const tmdl =
    `model Model\n\tculture: en-US\n\tdefaultPowerBIDataSourceVersion: powerBI_V3\n\n` +
    tables.map(tmdlForTable).join("\n\n");
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

export function applyFullPageHTML(pbipPath: string, html: string): string {
  // pbipPath = .../Project/Project.pbip
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const reportJsonPath = join(projectDir, `${projName}.Report`, "report.json");
  if (!existsSync(reportJsonPath)) {
    throw new Error(`report.json nicht gefunden unter ${reportJsonPath}`);
  }
  writeFileSync(
    reportJsonPath,
    JSON.stringify(buildReportJson({ htmlContent: html }), null, 2)
  );
  return reportJsonPath;
}

export function readMetadata(pbipPath: string): {
  tables: { name: string; columns: { name: string; dataType: string }[] }[];
} {
  // pbipPath = .../Project/Project.pbip
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const tmdlPath = join(projectDir, `${projName}.SemanticModel`, "definition", "model.tmdl");
  if (!existsSync(tmdlPath)) return { tables: [] };
  const txt = readFileSync(tmdlPath, "utf8");
  const tableRegex = /table '([^']+)'([\s\S]*?)(?=\ntable '|$)/g;
  const colRegex = /column '([^']+)'\s*\n\s*dataType:\s*(\w+)/g;
  const tables: { name: string; columns: { name: string; dataType: string }[] }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(txt))) {
    const name = m[1];
    const body = m[2];
    const cols: { name: string; dataType: string }[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = colRegex.exec(body))) {
      cols.push({ name: cm[1], dataType: cm[2] });
    }
    tables.push({ name, columns: cols });
  }
  return { tables };
}
