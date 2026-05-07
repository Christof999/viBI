import type { HelperStatus, MCPTool, PBIPProject } from "../types";

const HELPER_URL =
  (import.meta.env.VITE_HELPER_URL as string | undefined) ??
  "http://localhost:7321";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HELPER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Helper ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export const helper = {
  async status(): Promise<HelperStatus> {
    try {
      return await req<HelperStatus>("/status");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  openPowerBIDesktop(filePath?: string): Promise<{ ok: boolean }> {
    return req("/powerbi/open", {
      method: "POST",
      body: JSON.stringify({ filePath }),
    });
  },

  savePBIP(
    project: PBIPProject,
    targetDir: string
  ): Promise<{ ok: boolean; path: string }> {
    return req("/pbip/save", {
      method: "POST",
      body: JSON.stringify({ project, targetDir }),
    });
  },

  listMCPTools(): Promise<MCPTool[]> {
    return req("/mcp/tools");
  },

  callMCPTool(
    server: "fabric" | "custom",
    name: string,
    args: Record<string, unknown>
  ): Promise<{ result: unknown }> {
    return req("/mcp/call", {
      method: "POST",
      body: JSON.stringify({ server, name, args }),
    });
  },
};

export { HELPER_URL };
