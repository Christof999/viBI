// Minimal PBIP (Power BI Project) writer.
// Creates the folder layout PowerBI Desktop expects when "Save as project" is enabled:
//
//   <Project>/
//     <Project>.pbip
//     <Project>.SemanticModel/
//       definition.pbism
//       definition/model.tmdl
//     <Project>.Report/
//       definition.pbir
//       report.json
//
// This is a starter implementation — sufficient to open in PBI Desktop with a basic model.
// Real-world projects will want more sophisticated TMDL generation; you can extend
// this or have your custom MCP server handle it.

import { mkdirSync, writeFileSync } from "node:fs";
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
interface Project {
  name: string;
  tables: Table[];
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

  // M expression with inlined rows so the file is self-contained.
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

export function writePBIP(projectDir: string, project: Project): string {
  ensureDir(projectDir);
  const semDir = join(projectDir, `${project.name}.SemanticModel`);
  const semDefDir = join(semDir, "definition");
  const repDir = join(projectDir, `${project.name}.Report`);
  ensureDir(semDefDir);
  ensureDir(repDir);

  // .pbip pointer file
  const pbip = {
    version: "1.0",
    artifacts: [
      { report: { path: `${project.name}.Report` } },
    ],
    settings: { enableAutoRecovery: true },
  };
  writeFileSync(join(projectDir, `${project.name}.pbip`), JSON.stringify(pbip, null, 2));

  // SemanticModel definition.pbism
  writeFileSync(
    join(semDir, "definition.pbism"),
    JSON.stringify({ version: "4.0", settings: {} }, null, 2)
  );

  // model.tmdl
  const tmdl =
    `model Model\n\tculture: en-US\n\tdefaultPowerBIDataSourceVersion: powerBI_V3\n\n` +
    project.tables.map(tmdlForTable).join("\n\n");
  writeFileSync(join(semDefDir, "model.tmdl"), tmdl);

  // Report definition.pbir
  writeFileSync(
    join(repDir, "definition.pbir"),
    JSON.stringify(
      {
        version: "1.0",
        datasetReference: {
          byPath: { path: `../${project.name}.SemanticModel` },
        },
      },
      null,
      2
    )
  );

  // Minimal report.json (single empty page)
  writeFileSync(
    join(repDir, "report.json"),
    JSON.stringify(
      {
        config: '{"version":"5.43","themeCollection":{}}',
        layoutOptimization: 0,
        sections: [
          {
            name: "Page1",
            displayName: "Seite 1",
            displayOption: 1,
            visualContainers: [],
          },
        ],
      },
      null,
      2
    )
  );

  return join(projectDir, `${project.name}.pbip`);
}
