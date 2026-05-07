export type ChatRole = "user" | "model" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  toolName?: string;
  pending?: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  server: "fabric" | "custom";
}

export interface HelperStatus {
  ok: boolean;
  version?: string;
  powerBIDesktopFound?: boolean;
  mcp?: { fabric: boolean; custom: boolean };
  error?: string;
}

export type Phase = "onboarding" | "library" | "modeling" | "design";

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
  file?: string;
}

export type LocateResult =
  | { ok: true; pbipPath: string; via: "saved" | "search" }
  | { ok: false; reason: "not_found"; searched: string[] };

export interface SuggestedTable {
  name: string;
  source: string;
  purpose: string;
  keyColumns: string[];
}

export interface TableSuggestion {
  tables: SuggestedTable[];
  rationale: string;
}

export type ModelingStep = "proposal" | "working" | "finalizing";

export type ReportType = "report" | "paginated";

export interface CIColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface CIConfig {
  logoDataUrl?: string;
  colors: CIColors;
  fontFamily: string;
}

export interface ProjectConfig {
  name: string;
  fileName: string;
  reportType: ReportType;
  goal: string;
  ci: CIConfig;
  kpis: string[];
  createdAt: string;
}

export type SnippetType = "kpi" | "chart" | "table" | "custom";

export interface HtmlSnippet {
  id: string;
  name: string;
  type: SnippetType;
  html: string;
}

export interface AppState {
  phase: Phase;
  project?: ProjectConfig;
  pbipPath?: string;
  libraryId?: string;
  snippets: HtmlSnippet[];
  modelingStep?: ModelingStep;
  suggestion?: TableSuggestion;
  fullPageHtml?: string;
}

export interface PBIPProject {
  name: string;
  ci?: CIConfig;
  tables: PBIPTable[];
}

export interface PBIPTable {
  name: string;
  columns: PBIPColumn[];
  rows?: Record<string, string | number | boolean | null>[];
}

export interface PBIPColumn {
  name: string;
  dataType: "string" | "int64" | "double" | "boolean" | "dateTime";
}
