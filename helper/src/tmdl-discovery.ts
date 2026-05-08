// Erkennt das Datei-Layout eines PBIP-SemanticModels und liefert den
// rohen Inhalt aller TMDL-Dateien für Reads.
//
// Drei Layouts existieren in der Praxis:
//
// 1. "single-file" — viBI's writePBIP() schreibt alles in
//    <Project>.SemanticModel/definition/model.tmdl
//
// 2. "sharded"     — Power BI Desktop's eigenes Save-Format. model.tmdl
//    enthält nur den Modell-Header. Tabellen liegen in
//    definition/tables/<Tabelle>.tmdl, Beziehungen in
//    definition/relationships.tmdl oder definition/relationships/*.tmdl,
//    Kulturen, Rollen etc. in eigenen Unterordnern.
//
// 3. "bim"         — Legacy: ein einzelnes definition.bim oder model.bim
//    mit JSON Tabular Model. Kommt bei sehr alten Dateien vor.
//
// Diese Funktion liefert eine vereinheitlichte Sicht. Reader (listModel,
// readMetadata) bekommen den concat-content; Writer (add_measure etc.)
// bekommen die Datei-Liste, um gezielt eine Datei zu schreiben.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredModel {
  layout: "single-file" | "sharded" | "bim" | "none";
  semanticModelDir: string;
  definitionDir: string;
  files: { path: string; content: string }[];
  bimPath?: string;
  bimJson?: unknown;
}

export function discoverModel(pbipPath: string): DiscoveredModel {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const semanticModelDir = join(projectDir, `${projName}.SemanticModel`);
  const definitionDir = join(semanticModelDir, "definition");

  if (!existsSync(semanticModelDir)) {
    return { layout: "none", semanticModelDir, definitionDir, files: [] };
  }

  // Legacy .bim
  for (const candidate of [
    join(semanticModelDir, "definition.bim"),
    join(semanticModelDir, "model.bim"),
  ]) {
    if (existsSync(candidate)) {
      try {
        return {
          layout: "bim",
          semanticModelDir,
          definitionDir,
          files: [],
          bimPath: candidate,
          bimJson: JSON.parse(readFileSync(candidate, "utf8")),
        };
      } catch {
        /* fall through */
      }
    }
  }

  if (!existsSync(definitionDir)) {
    return { layout: "none", semanticModelDir, definitionDir, files: [] };
  }

  const files: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (entry.toLowerCase().endsWith(".tmdl")) {
        try {
          files.push({ path: p, content: readFileSync(p, "utf8") });
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(definitionDir);

  if (files.length === 0) {
    return { layout: "none", semanticModelDir, definitionDir, files: [] };
  }

  // sharded, wenn ein "tables"-Unterordner existiert oder mehrere Files unterhalb
  const hasTablesDir = existsSync(join(definitionDir, "tables"));
  const hasMultipleTopLevel =
    files.filter((f) => f.path.replace(/\\/g, "/").split("/").pop() !== "model.tmdl")
      .length > 0 && hasTablesDir;
  return {
    layout: hasMultipleTopLevel || hasTablesDir ? "sharded" : "single-file",
    semanticModelDir,
    definitionDir,
    files,
  };
}

// Vereint alle TMDL-Inhalte für regex-basierte Reads. Setzt Datei-Marker, damit
// Schreib-Operationen wissen, in welcher Datei welcher Block lebt.
export function concatenatedTmdl(d: DiscoveredModel): string {
  return d.files.map((f) => `### __VIBI_FILE__: ${f.path}\n${f.content}`).join("\n\n");
}
