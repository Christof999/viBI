// Library / project registry, persisted to ~/.vibi/library.json on the user's PC.
//
// Stores:
// - "projects": every PBIP we created or opened (name, path, CI, KPIs, goal, lastOpenedAt)
// - "ciPresets": reusable Corporate-Identity templates the user saves during onboarding
//
// Project locate strategy (3-stage):
//   1. saved pbipPath still exists?            → use it
//   2. shallow recursive search by file name   → use it (and update path)
//   3. neither found                            → 404, frontend prompts user

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CIColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}
interface CIConfig {
  logoDataUrl?: string;
  colors: CIColors;
  fontFamily: string;
}

export interface LibraryProject {
  id: string;
  name: string;
  fileName: string;
  pbipPath: string;
  goal: string;
  ci: CIConfig;
  kpis: string[];
  createdAt: string;
  lastOpenedAt: string;
}

export interface CIPreset {
  id: string;
  name: string;
  ci: CIConfig;
  createdAt: string;
}

export interface Library {
  projects: LibraryProject[];
  ciPresets: CIPreset[];
}

const ROOT = join(homedir(), ".vibi");
const LIBRARY_FILE = join(ROOT, "library.json");

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyLibrary(): Library {
  return { projects: [], ciPresets: [] };
}

export function loadLibrary(): Library {
  try {
    if (!existsSync(LIBRARY_FILE)) return emptyLibrary();
    const parsed = JSON.parse(readFileSync(LIBRARY_FILE, "utf8")) as Partial<Library>;
    return {
      projects: parsed.projects ?? [],
      ciPresets: parsed.ciPresets ?? [],
    };
  } catch {
    return emptyLibrary();
  }
}

export function saveLibrary(lib: Library) {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  writeFileSync(LIBRARY_FILE, JSON.stringify(lib, null, 2), "utf8");
}

export function libraryPath(): string {
  return LIBRARY_FILE;
}

export function upsertProject(
  partial: Omit<LibraryProject, "id" | "createdAt" | "lastOpenedAt"> &
    Partial<Pick<LibraryProject, "id" | "createdAt" | "lastOpenedAt">>
): LibraryProject {
  const lib = loadLibrary();
  const now = new Date().toISOString();
  const existing = lib.projects.find(
    (p) =>
      (partial.id && p.id === partial.id) ||
      p.pbipPath.toLowerCase() === partial.pbipPath.toLowerCase()
  );
  const merged: LibraryProject = {
    id: existing?.id ?? partial.id ?? uid(),
    createdAt: existing?.createdAt ?? partial.createdAt ?? now,
    lastOpenedAt: now,
    name: partial.name,
    fileName: partial.fileName,
    pbipPath: partial.pbipPath,
    goal: partial.goal,
    ci: partial.ci,
    kpis: partial.kpis,
  };
  lib.projects = [merged, ...lib.projects.filter((p) => p.id !== merged.id)];
  saveLibrary(lib);
  return merged;
}

export function removeProject(id: string): boolean {
  const lib = loadLibrary();
  const before = lib.projects.length;
  lib.projects = lib.projects.filter((p) => p.id !== id);
  if (lib.projects.length === before) return false;
  saveLibrary(lib);
  return true;
}

export function setProjectPath(id: string, pbipPath: string): LibraryProject | null {
  const lib = loadLibrary();
  const p = lib.projects.find((x) => x.id === id);
  if (!p) return null;
  p.pbipPath = pbipPath;
  p.lastOpenedAt = new Date().toISOString();
  saveLibrary(lib);
  return p;
}

export function touchProject(id: string): LibraryProject | null {
  const lib = loadLibrary();
  const p = lib.projects.find((x) => x.id === id);
  if (!p) return null;
  p.lastOpenedAt = new Date().toISOString();
  saveLibrary(lib);
  return p;
}

export function upsertCIPreset(name: string, ci: CIConfig, id?: string): CIPreset {
  const lib = loadLibrary();
  const now = new Date().toISOString();
  const existing = id ? lib.ciPresets.find((p) => p.id === id) : undefined;
  const merged: CIPreset = {
    id: existing?.id ?? id ?? uid(),
    name,
    ci,
    createdAt: existing?.createdAt ?? now,
  };
  lib.ciPresets = [merged, ...lib.ciPresets.filter((p) => p.id !== merged.id)];
  saveLibrary(lib);
  return merged;
}

export function removeCIPreset(id: string): boolean {
  const lib = loadLibrary();
  const before = lib.ciPresets.length;
  lib.ciPresets = lib.ciPresets.filter((p) => p.id !== id);
  if (lib.ciPresets.length === before) return false;
  saveLibrary(lib);
  return true;
}

// --- Locate ----------------------------------------------------------------

const SEARCH_DIRS = (): string[] => {
  const home = homedir();
  return [
    process.env.VIBI_DEFAULT_DIR,
    join(home, "Documents", "Power BI Desktop"),
    join(home, "Documents"),
    join(home, "OneDrive", "Documents"),
    join(home, "OneDrive - Documents"),
    join(home, "Desktop"),
    "C:/PowerBI",
    "C:/PowerBI/viBI",
  ].filter((d): d is string => !!d && existsSync(d));
};

function findPBIPByName(name: string, fileName: string, maxDepth = 4): string[] {
  const targets = new Set([
    `${name}.pbip`.toLowerCase(),
    `${fileName}.pbip`.toLowerCase(),
  ]);
  const hits: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || hits.length >= 5) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (targets.has(entry.toLowerCase())) {
        hits.push(full);
      }
      if (hits.length >= 5) return;
    }
  };

  for (const root of SEARCH_DIRS()) walk(root, 0);
  return hits;
}

export type LocateResult =
  | { ok: true; pbipPath: string; via: "saved" | "search" }
  | { ok: false; reason: "not_found"; searched: string[] };

export function locateProject(id: string): LocateResult {
  const lib = loadLibrary();
  const project = lib.projects.find((p) => p.id === id);
  if (!project) return { ok: false, reason: "not_found", searched: [] };

  if (project.pbipPath && existsSync(project.pbipPath)) {
    touchProject(id);
    return { ok: true, pbipPath: project.pbipPath, via: "saved" };
  }

  const found = findPBIPByName(project.name, project.fileName);
  if (found.length > 0) {
    setProjectPath(id, found[0]);
    return { ok: true, pbipPath: found[0], via: "search" };
  }

  return { ok: false, reason: "not_found", searched: SEARCH_DIRS() };
}
