// Sucht nach .pbip-Dateien an typischen Speicherorten. Wird genutzt, wenn der
// in der App gespeicherte Pfad nicht (mehr) zur tatsächlich vom User
// bearbeiteten Datei führt – z.B. wenn der User aus PBI Desktop "Speichern
// unter" in den eigenen Documents-Ordner gemacht hat.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface FoundPbip {
  path: string;
  name: string;
  mtimeMs: number;
}

function rootCandidates(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (!home) return [];
  const roots = [
    join(home, "Documents"),
    join(home, "OneDrive", "Documents"),
    join(home, "OneDrive - SharePoint", "Documents"),
    join(home, "Desktop"),
    "C:/PowerBI",
  ];
  // OneDrive- mit beliebigem Tenant-Suffix einsammeln
  try {
    for (const e of readdirSync(home)) {
      if (e.startsWith("OneDrive - ")) {
        roots.push(join(home, e, "Documents"));
        roots.push(join(home, e));
      }
    }
  } catch {
    /* ignore */
  }
  return roots.filter((r, i, a) => a.indexOf(r) === i);
}

export function findRecentPbips(opts: {
  maxAgeDays?: number;
  maxDepth?: number;
  nameContains?: string;
} = {}): FoundPbip[] {
  const maxAge = (opts.maxAgeDays ?? 14) * 24 * 60 * 60 * 1000;
  const maxDepth = opts.maxDepth ?? 5;
  const filter = opts.nameContains?.toLowerCase();
  const now = Date.now();
  const found = new Map<string, FoundPbip>();

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      // Standard-System-Ordner und versteckte Dateien überspringen
      if (
        entry.startsWith(".") ||
        entry === "node_modules" ||
        entry === "AppData" ||
        entry === "Library" ||
        entry === "$RECYCLE.BIN" ||
        entry === "System Volume Information"
      ) {
        continue;
      }
      const p = join(dir, entry);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
      } else if (entry.toLowerCase().endsWith(".pbip")) {
        if (now - st.mtimeMs > maxAge) continue;
        if (filter && !entry.toLowerCase().includes(filter)) continue;
        found.set(p, {
          path: p,
          name: entry.replace(/\.pbip$/i, ""),
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };

  for (const r of rootCandidates()) {
    if (existsSync(r)) walk(r, 0);
  }

  return [...found.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Heuristik: bestes Match für einen Projektnamen finden. Nutzt:
// - exakte Datei-Namens-Gleichheit (case insensitive)
// - sonst: jüngste, deren Name den Projektnamen enthält
// - sonst: jüngste überhaupt
export function bestPbipFor(projectName: string | undefined): FoundPbip | null {
  const all = findRecentPbips();
  if (all.length === 0) return null;
  if (!projectName) return all[0];
  const lower = projectName.toLowerCase();
  const exact = all.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = all.find((p) => p.name.toLowerCase().includes(lower));
  return partial ?? all[0];
}
