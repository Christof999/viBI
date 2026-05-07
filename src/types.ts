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

export interface PBIPProject {
  name: string;
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
