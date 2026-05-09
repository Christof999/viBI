// Speichert/lädt das full-page-HTML pro Projekt. Frontend (DesignPanel) und
// KI (über Built-in-Tools) teilen sich den State über diese Datei, damit sich
// ihre Bearbeitungen gegenseitig sehen.
//
// Datei liegt direkt neben der .pbip als ".vibi-design.html" – nicht innerhalb
// der Report-Folders, weil PBI Desktop dort beim Save aufräumen würde.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function designPath(pbipPath: string): string {
  return join(dirname(pbipPath), ".vibi-design.html");
}

export function getDesignHtml(pbipPath: string): string | null {
  const p = designPath(pbipPath);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function setDesignHtml(pbipPath: string, html: string): string {
  const p = designPath(pbipPath);
  writeFileSync(p, html, "utf8");
  return p;
}

// Schreibt eine standalone HTML-Datei in <Project>.Report/StaticResources/RegisteredResources/.
// Selbst wenn das Custom-Visual-Embedding scheitert, hat der User damit einen
// Doppelklick-fähigen Report-Output, der im Browser läuft.
export function writeStandaloneHtml(pbipPath: string, html: string): string {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const dir = join(projectDir, `${projName}.Report`, "StaticResources", "RegisteredResources");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = join(dir, "vibi-design.html");
  writeFileSync(target, html, "utf8");
  return target;
}
