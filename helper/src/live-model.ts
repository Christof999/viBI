// Liest das *Live*-Modell aus Power BI Desktops AnalysisServicesWorkspaces.
//
// Hintergrund: PBI Desktop startet pro offener Datei eine Analysis-Services-
// Workspace-Instanz unter
//   %LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\AnalysisServicesWorkspace_<rand>\Data\
// Dort liegt eine Model.bim (Tabular JSON), die immer den aktuellen Stand des
// In-Memory-Modells widerspiegelt – auch ohne dass der User gespeichert hat.
//
// Das ist genau die Datenquelle, die wir brauchen, wenn der User in PBI gerade
// echte BC-Tabellen geladen hat, der .pbip aber noch nicht gespeichert ist.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LiveTable {
  name: string;
  columns: { name: string; dataType: string }[];
  measures: { name: string; expression: string }[];
}
export interface LiveRelationship {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive?: boolean;
}
export interface LiveModelResult {
  source: "live-workspace" | "none";
  workspacePath?: string;
  tables: LiveTable[];
  relationships: LiveRelationship[];
}

function workspacesRoot(): string | null {
  const localApp =
    process.env.LOCALAPPDATA ??
    (process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Local") : null);
  if (!localApp) return null;
  return join(localApp, "Microsoft", "Power BI Desktop", "AnalysisServicesWorkspaces");
}

function safeStat(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

export function readLiveModel(): LiveModelResult {
  const root = workspacesRoot();
  if (!root || !existsSync(root)) {
    return { source: "none", tables: [], relationships: [] };
  }
  let entries: { path: string; mtime: number }[] = [];
  try {
    entries = readdirSync(root)
      .map((d) => join(root, d))
      .filter((p) => safeStat(p)?.isDirectory())
      .map((p) => ({ path: p, mtime: safeStat(p)?.mtimeMs ?? 0 }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return { source: "none", tables: [], relationships: [] };
  }

  for (const entry of entries) {
    const bim = join(entry.path, "Data", "Model.bim");
    if (!existsSync(bim)) continue;
    try {
      const raw = readFileSync(bim, "utf8");
      const json = JSON.parse(raw);
      const model = (json.model ?? json) as {
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
          isActive?: boolean;
        }>;
      };
      const tables: LiveTable[] = (model.tables ?? [])
        .filter((t) => !t.name.startsWith("DateTableTemplate") && !t.name.startsWith("LocalDateTable"))
        .map((t) => ({
          name: t.name,
          columns: (t.columns ?? [])
            .filter((c) => !c.name.startsWith("RowNumber-"))
            .map((c) => ({ name: c.name, dataType: c.dataType ?? "unknown" })),
          measures: (t.measures ?? []).map((m) => ({
            name: m.name,
            expression: Array.isArray(m.expression)
              ? m.expression.join("\n")
              : m.expression ?? "",
          })),
        }));
      const relationships: LiveRelationship[] = (model.relationships ?? []).map((r) => ({
        name: r.name ?? "",
        fromTable: r.fromTable ?? "",
        fromColumn: r.fromColumn ?? "",
        toTable: r.toTable ?? "",
        toColumn: r.toColumn ?? "",
        isActive: r.isActive,
      }));
      // Skipping the empty/unloaded workspaces (only system tables, no user data)
      if (tables.length === 0) continue;
      return {
        source: "live-workspace",
        workspacePath: entry.path,
        tables,
        relationships,
      };
    } catch {
      continue;
    }
  }
  return { source: "none", tables: [], relationships: [] };
}

// Erkennt den viBI-Platzhalter, der beim Erstellen eines PBIP geschrieben wird.
// Ein Bericht, dessen TMDL nur „Sales" mit Date/Region/<KPI> enthält, war
// offensichtlich nie in PBI Desktop gespeichert nachdem echte Daten geladen wurden.
export function looksLikeViBIPlaceholder(tables: { name: string; columns: { name: string }[] }[]): boolean {
  if (tables.length !== 1) return false;
  const t = tables[0];
  if (t.name !== "Sales") return false;
  if (t.columns.length === 0 || t.columns.length > 5) return false;
  const colNames = t.columns.map((c) => c.name.toLowerCase());
  return colNames.includes("date") && colNames.includes("region");
}
