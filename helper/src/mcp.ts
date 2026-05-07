// Manages stdio MCP client connections to:
//  - "fabric": the official Microsoft Fabric / PowerBI MCP server
//  - "custom": a user-supplied MCP server (added later in this repo)
//
// Both server commands are configured via env vars so the helper has no hard
// dependency on either being installed.
//
// FABRIC_MCP_COMMAND="npx" FABRIC_MCP_ARGS="-y @microsoft/mcp-fabric"
// CUSTOM_MCP_COMMAND="node" CUSTOM_MCP_ARGS="../mcp-server/dist/index.js"

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type ServerKey = "fabric" | "custom";

interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  server: ServerKey;
}

function readConfig(prefix: string): ServerConfig | null {
  const command = process.env[`${prefix}_MCP_COMMAND`];
  if (!command) return null;
  const args = (process.env[`${prefix}_MCP_ARGS`] ?? "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
  return { command, args };
}

class Registry {
  private clients: Partial<Record<ServerKey, Client>> = {};
  private tools: ToolDescriptor[] = [];

  isConnected(server: ServerKey) {
    return !!this.clients[server];
  }

  async init() {
    const targets: { key: ServerKey; cfg: ServerConfig | null }[] = [
      { key: "fabric", cfg: readConfig("FABRIC") },
      { key: "custom", cfg: readConfig("CUSTOM") },
    ];

    for (const { key, cfg } of targets) {
      if (!cfg) {
        console.log(`[mcp] ${key}: nicht konfiguriert (überspringe)`);
        continue;
      }
      try {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        });
        const client = new Client(
          { name: `vibi-helper-${key}`, version: "0.1.0" },
          { capabilities: {} }
        );
        await client.connect(transport);
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
        console.log(`[mcp] ${key}: verbunden (${list.tools?.length ?? 0} Tools)`);
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
