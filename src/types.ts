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

export type Phase = "onboarding" | "modeling" | "design";

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
  snippets: HtmlSnippet[];
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
