// Manages MCP client connections. Supports both stdio (locally spawned) and
// streamable-HTTP (remote) MCP servers.
//
// Konfigurierte Slots:
//  - "fabric": (legacy) lokaler Fabric/PowerBI MCP-Server via stdio
//  - "custom": eigener stdio-MCP-Server
//  - "remote": HTTP-basierter Remote-MCP-Server (z.B. der offizielle Microsoft
//              Power BI Remote-MCP). Konfiguration über REMOTE_MCP_URL und
//              optional REMOTE_MCP_AUTH (z.B. "Bearer eyJ...")
//
// Env-Variablen:
//   FABRIC_MCP_COMMAND="npx" FABRIC_MCP_ARGS="-y @microsoft/mcp-fabric"
//   CUSTOM_MCP_COMMAND="node" CUSTOM_MCP_ARGS="../mcp-server/dist/index.js"
//   REMOTE_MCP_URL="https://mcp.fabric.microsoft.com/powerbi/v1/mcp"
//   REMOTE_MCP_AUTH="Bearer <Entra-Access-Token>"

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ServerKey = "fabric" | "custom" | "remote";

type ServerConfig =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; authHeader?: string };

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  server: ServerKey;
}

function readStdio(prefix: string): ServerConfig | null {
  const command = process.env[`${prefix}_MCP_COMMAND`];
  if (!command) return null;
  const args = (process.env[`${prefix}_MCP_ARGS`] ?? "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
  return { type: "stdio", command, args };
}

function readHttp(prefix: string): ServerConfig | null {
  const url = process.env[`${prefix}_MCP_URL`];
  if (!url) return null;
  const auth = process.env[`${prefix}_MCP_AUTH`];
  return { type: "http", url, authHeader: auth };
}

class Registry {
  private clients: Partial<Record<ServerKey, Client>> = {};
  private tools: ToolDescriptor[] = [];

  isConnected(server: ServerKey) {
    return !!this.clients[server];
  }

  async init() {
    const targets: { key: ServerKey; cfg: ServerConfig | null }[] = [
      { key: "fabric", cfg: readStdio("FABRIC") ?? readHttp("FABRIC") },
      { key: "custom", cfg: readStdio("CUSTOM") ?? readHttp("CUSTOM") },
      { key: "remote", cfg: readHttp("REMOTE") ?? readStdio("REMOTE") },
    ];

    for (const { key, cfg } of targets) {
      if (!cfg) {
        console.log(`[mcp] ${key}: nicht konfiguriert (überspringe)`);
        continue;
      }
      try {
        const client = new Client(
          { name: `vibi-helper-${key}`, version: "0.1.0" },
          { capabilities: {} }
        );
        if (cfg.type === "stdio") {
          const transport = new StdioClientTransport({
            command: cfg.command,
            args: cfg.args,
            env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
          });
          await client.connect(transport);
        } else {
          const headers: Record<string, string> = {};
          if (cfg.authHeader) headers.Authorization = cfg.authHeader;
          const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: { headers },
          });
          await client.connect(transport);
        }
        this.clients[key] = client;

        const list = await client.listTools();
        for (const t of list.tools ?? []) {
          this.tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown> | undefined,
            server: key,
          });
        }
        const transportLabel = cfg.type === "http" ? `HTTP @ ${cfg.url}` : `stdio (${cfg.command})`;
        console.log(`[mcp] ${key}: verbunden via ${transportLabel} (${list.tools?.length ?? 0} Tools)`);
      } catch (e) {
        console.warn(`[mcp] ${key}: Verbindung fehlgeschlagen – ${(e as Error).message}`);
      }
    }
  }

  async listTools(): Promise<ToolDescriptor[]> {
    return this.tools;
  }

  async callTool(server: ServerKey, name: string, args: Record<string, unknown>) {
    const client = this.clients[server];
    if (!client) throw new Error(`MCP-Server "${server}" ist nicht verbunden.`);
    return await client.callTool({ name, arguments: args });
  }
}

export const mcpRegistry = new Registry();
