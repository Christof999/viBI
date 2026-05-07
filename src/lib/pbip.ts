import type { PBIPProject } from "../types";

export function emptyProject(name = "MyReport"): PBIPProject {
  return {
    name,
    tables: [
      {
        name: "Sales",
        columns: [
          { name: "Date", dataType: "dateTime" },
          { name: "Region", dataType: "string" },
          { name: "Revenue", dataType: "double" },
        ],
        rows: [
          { Date: "2026-01-01", Region: "EU", Revenue: 12450.5 },
          { Date: "2026-01-02", Region: "US", Revenue: 9870.0 },
          { Date: "2026-01-03", Region: "APAC", Revenue: 5432.1 },
        ],
      },
    ],
  };
}

export function projectToTMDL(project: PBIPProject): string {
  const tables = project.tables
    .map((t) => {
      const cols = t.columns
        .map(
          (c) =>
            `  column ${c.name}\n    dataType: ${c.dataType}\n    sourceColumn: ${c.name}`
        )
        .join("\n\n");
      return `table ${t.name}\n${cols}`;
    })
    .join("\n\n");

  return `model Model\n  culture: en-US\n\n${tables}\n`;
}
