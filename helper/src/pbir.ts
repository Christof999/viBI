// PBIR (Enhanced Report Format) Writer – implementiert das Hybrid-Konzept aus
// SKILL.md (pbi-report-builder): NIE ein PBIP von Null erzeugen, sondern in
// einen existierenden, von PBI Desktop gespeicherten PBIP-Ordner die page-/
// visual-JSONs schreiben. Layout:
//
//   <Project>.Report/definition/
//     report.json                      ← Desktop owned (nicht anfassen)
//     version.json                     ← Desktop owned
//     pages/
//       pages.json                     ← WE MODIFY (pageOrder erweitern)
//       pg01Overview/                  ← WE CREATE
//         page.json                    ← WE CREATE
//         visuals/
//           v01KpiSales/visual.json    ← WE CREATE
//
// Wichtige Regeln (siehe SKILL.md):
//  • Schema-Version aus existierenden visual.json discoveren statt
//    hardcoden (verändert sich mit Desktop-Updates).
//  • Page-Nummer auto-inkrementieren (pg##), nie raten.
//  • name-Feld in page.json/visual.json MUSS exakt zur Folder-Name passen.
//  • Tabellen-/Spalten-/Measure-Namen sind case-sensitive und müssen 1:1 aus
//    dem Modell kommen.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DEFAULT_PAGE_SCHEMA =
  "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json";
const DEFAULT_VISUAL_SCHEMA =
  "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.0.0/schema.json";
const DEFAULT_PAGES_SCHEMA =
  "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json";

export interface PbirLayout {
  projectDir: string;
  projectName: string;
  reportDir: string;
  definitionDir: string;
  pagesDir: string;
}

export function discoverPbirLayout(pbipPath: string): PbirLayout {
  const projectDir = pbipPath.replace(/[\\/][^\\/]+\.pbip$/, "");
  const projectName = pbipPath.split(/[\\/]/).pop()!.replace(/\.pbip$/, "");
  const reportDir = join(projectDir, `${projectName}.Report`);
  const definitionDir = join(reportDir, "definition");
  const pagesDir = join(definitionDir, "pages");
  return { projectDir, projectName, reportDir, definitionDir, pagesDir };
}

// Liest ein existierendes visual.json aus dem PBIP und liest dessen $schema-
// Wert aus – das ist die Version, die Desktop in dieser Installation nutzt.
// Fallback auf die letzte bekannte 2.0.0-Version, wenn nichts da ist.
export function detectVisualSchema(pagesDir: string): string {
  if (!existsSync(pagesDir)) return DEFAULT_VISUAL_SCHEMA;
  let pages: string[];
  try {
    pages = readdirSync(pagesDir).filter((d) => d.startsWith("pg"));
  } catch {
    return DEFAULT_VISUAL_SCHEMA;
  }
  for (const pg of pages) {
    const visDir = join(pagesDir, pg, "visuals");
    if (!existsSync(visDir)) continue;
    let visuals: string[];
    try {
      visuals = readdirSync(visDir);
    } catch {
      continue;
    }
    for (const v of visuals) {
      const f = join(visDir, v, "visual.json");
      if (!existsSync(f)) continue;
      try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        if (typeof j["$schema"] === "string") return j["$schema"] as string;
      } catch {
        /* skip malformed */
      }
    }
  }
  return DEFAULT_VISUAL_SCHEMA;
}

export function detectPageSchema(pagesDir: string): string {
  if (!existsSync(pagesDir)) return DEFAULT_PAGE_SCHEMA;
  let pages: string[];
  try {
    pages = readdirSync(pagesDir).filter((d) => d.startsWith("pg"));
  } catch {
    return DEFAULT_PAGE_SCHEMA;
  }
  for (const pg of pages) {
    const f = join(pagesDir, pg, "page.json");
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (typeof j["$schema"] === "string") return j["$schema"] as string;
    } catch {
      /* skip */
    }
  }
  return DEFAULT_PAGE_SCHEMA;
}

export function nextPageNumber(pagesDir: string): number {
  if (!existsSync(pagesDir)) return 1;
  let pages: string[];
  try {
    pages = readdirSync(pagesDir).filter((d) => {
      try {
        return statSync(join(pagesDir, d)).isDirectory() && /^pg\d+/.test(d);
      } catch {
        return false;
      }
    });
  } catch {
    return 1;
  }
  const nums = pages
    .map((p) => parseInt(p.replace(/^pg(\d+).*/, "$1"), 10))
    .filter((n) => !Number.isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function sanitizeNamePart(s: string): string {
  // Erlaubte Zeichen für page/visual names: Buchstaben + Ziffern. Spaces, Punkte
  // etc. raus. Max 50 Zeichen pro SKILL.md.
  const clean = s
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/^\d+/, ""); // führende Ziffern entfernen, damit pg##Name eindeutig bleibt
  return clean.slice(0, 40) || "Page";
}

export function pgFolderName(num: number, displayName: string): string {
  return `pg${String(num).padStart(2, "0")}${sanitizeNamePart(displayName)}`;
}

export function vFolderName(num: number, baseName: string): string {
  return `v${String(num).padStart(2, "0")}${sanitizeNamePart(baseName)}`;
}

export type ProjectionKind = "measure" | "column";
export interface PbirFieldProjection {
  kind: ProjectionKind;
  table: string;
  name: string;
}

export interface PbirVisualSpec {
  // Sprechender Name, wird zu "v01KpiSales" gemappt
  baseName: string;
  visualType: string; // z.B. "cardVisual", "clusteredColumnChart", "lineChart", ...
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
    z?: number;
    tabOrder?: number;
  };
  // Map von QueryRole → Projektionen (Reihenfolge der Bindungen).
  // Beispiel für cardVisual: { Data: [...], ReferenceLabels: [...], AdditionalMeasure: [...] }
  // Beispiel für clusteredColumnChart: { Category: [...], Y: [...] }
  queryState: Record<string, PbirFieldProjection[]>;
  // Optional: freie objects-Block, der einfach durchgereicht wird (z.B. Formatierung)
  objects?: Record<string, unknown>;
  drillFilterOtherVisuals?: boolean;
}

function fieldExpression(p: PbirFieldProjection) {
  const Property = p.name;
  const sourceRef = { Entity: p.table };
  if (p.kind === "measure") {
    return { Measure: { Expression: { SourceRef: sourceRef }, Property } };
  }
  return { Column: { Expression: { SourceRef: sourceRef }, Property } };
}

function buildVisualJson(
  schema: string,
  spec: PbirVisualSpec,
  folderName: string
) {
  const queryState: Record<string, unknown> = {};
  for (const [role, projs] of Object.entries(spec.queryState)) {
    queryState[role] = {
      projections: projs.map((p) => ({
        field: fieldExpression(p),
        queryRef: `${p.table}.${p.name}`,
        nativeQueryRef: p.name,
      })),
    };
  }
  return {
    $schema: schema,
    name: folderName,
    position: {
      x: spec.position.x,
      y: spec.position.y,
      z: spec.position.z ?? 1000,
      width: spec.position.width,
      height: spec.position.height,
      tabOrder: spec.position.tabOrder ?? 0,
    },
    visual: {
      visualType: spec.visualType,
      query: { queryState },
      objects: spec.objects ?? {},
      drillFilterOtherVisuals: spec.drillFilterOtherVisuals ?? true,
    },
  };
}

export interface WrittenPbirPage {
  pageFolder: string;
  pageJsonPath: string;
  visualPaths: string[];
  schemaUsed: string;
  pageNumber: number;
}

export interface AddPbirPageInput {
  pbipPath: string;
  displayName: string;
  width?: number;
  height?: number;
  displayOption?: "FitToPage" | "FitToWidth" | "ActualSize";
  pageType?: "Standard" | "Drillthrough" | "Tooltip";
  visuals: PbirVisualSpec[];
}

// Schreibt eine neue Page mit beliebig vielen Visuals nach SKILL.md-Konvention.
// Setzt voraus, dass der PBIP von PBI Desktop angelegt wurde (definition/pages
// existiert) – legt aber notfalls die Struktur an.
export function addPbirPage(input: AddPbirPageInput): WrittenPbirPage {
  const layout = discoverPbirLayout(input.pbipPath);
  if (!existsSync(layout.reportDir)) {
    throw new Error(
      `Report-Ordner nicht gefunden: ${layout.reportDir}. ` +
        `PBI Desktop muss den Bericht einmal als PBIP gespeichert haben, bevor viBI Visuals einfügen kann.`
    );
  }
  mkdirSync(layout.pagesDir, { recursive: true });

  const visualSchema = detectVisualSchema(layout.pagesDir);
  const pageSchema = detectPageSchema(layout.pagesDir);
  const pageNum = nextPageNumber(layout.pagesDir);
  const pageFolder = pgFolderName(pageNum, input.displayName);
  const pageDir = join(layout.pagesDir, pageFolder);
  const visualsDir = join(pageDir, "visuals");
  mkdirSync(visualsDir, { recursive: true });

  // page.json
  const pageJson: Record<string, unknown> = {
    $schema: pageSchema,
    name: pageFolder,
    displayName: input.displayName,
    displayOption: input.displayOption ?? "FitToPage",
    width: input.width ?? 1280,
    height: input.height ?? 720,
  };
  if (input.pageType && input.pageType !== "Standard") {
    pageJson.type = input.pageType;
  }
  const pageJsonPath = join(pageDir, "page.json");
  writeFileSync(pageJsonPath, JSON.stringify(pageJson, null, 2), "utf8");

  // visual.json pro Visual
  const visualPaths: string[] = [];
  input.visuals.forEach((spec, idx) => {
    const folder = vFolderName(idx + 1, spec.baseName);
    const vDir = join(visualsDir, folder);
    mkdirSync(vDir, { recursive: true });
    const visualJson = buildVisualJson(visualSchema, spec, folder);
    const vPath = join(vDir, "visual.json");
    writeFileSync(vPath, JSON.stringify(visualJson, null, 2), "utf8");
    visualPaths.push(vPath);
  });

  // pages.json aktualisieren (oder anlegen)
  const pagesJsonPath = join(layout.pagesDir, "pages.json");
  let pagesJson: { $schema?: string; pageOrder?: string[]; activePageName?: string };
  if (existsSync(pagesJsonPath)) {
    try {
      pagesJson = JSON.parse(readFileSync(pagesJsonPath, "utf8"));
    } catch {
      pagesJson = {};
    }
  } else {
    pagesJson = {};
  }
  if (!pagesJson.$schema) pagesJson.$schema = DEFAULT_PAGES_SCHEMA;
  if (!Array.isArray(pagesJson.pageOrder)) pagesJson.pageOrder = [];
  if (!pagesJson.pageOrder.includes(pageFolder)) {
    pagesJson.pageOrder.push(pageFolder);
  }
  if (!pagesJson.activePageName) pagesJson.activePageName = pageFolder;
  writeFileSync(pagesJsonPath, JSON.stringify(pagesJson, null, 2), "utf8");

  return {
    pageFolder,
    pageJsonPath,
    visualPaths,
    schemaUsed: visualSchema,
    pageNumber: pageNum,
  };
}
