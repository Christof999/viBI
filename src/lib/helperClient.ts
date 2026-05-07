import type {
  CIConfig,
  CIPreset,
  HelperStatus,
  Library,
  LibraryProject,
  LocateResult,
  MCPTool,
  ProjectConfig,
} from "../types";

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

  closePowerBIDesktop(): Promise<{ ok: boolean }> {
    return req("/powerbi/close", { method: "POST" });
  },

  createProject(
    project: ProjectConfig,
    targetDir: string
  ): Promise<{ ok: boolean; path: string; libraryId: string }> {
    return req("/project/create", {
      method: "POST",
      body: JSON.stringify({ project, targetDir }),
    });
  },

  library(): Promise<Library> {
    return req<Library>("/library");
  },

  locateProject(id: string): Promise<LocateResult> {
    return req<LocateResult>(`/library/projects/${encodeURIComponent(id)}/locate`, {
      method: "POST",
    });
  },

  setProjectPath(
    id: string,
    pbipPath: string
  ): Promise<{ ok: boolean; project?: LibraryProject; error?: string }> {
    return req(`/library/projects/${encodeURIComponent(id)}/path`, {
      method: "POST",
      body: JSON.stringify({ pbipPath }),
    });
  },

  removeProject(id: string): Promise<{ ok: boolean }> {
    return req(`/library/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  saveCIPreset(name: string, ci: CIConfig, id?: string): Promise<{ ok: boolean; preset: CIPreset }> {
    return req("/library/ci-presets", {
      method: "POST",
      body: JSON.stringify({ name, ci, id }),
    });
  },

  removeCIPreset(id: string): Promise<{ ok: boolean }> {
    return req(`/library/ci-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  readProjectMetadata(pbipPath: string): Promise<{
    tables: { name: string; columns: { name: string; dataType: string }[] }[];
  }> {
    return req("/project/metadata", {
      method: "POST",
      body: JSON.stringify({ pbipPath }),
    });
  },

  listMCPTools(): Promise<MCPTool[]> {
    return req("/mcp/tools");
  },

  callMCPTool(
    server: "fabric" | "custom" | "helper",
    name: string,
    args: Record<string, unknown>
  ): Promise<{ result: unknown }> {
    return req("/mcp/call", {
      method: "POST",
      body: JSON.stringify({ server, name, args }),
    });
  },

  runModeling(input: {
    goal: string;
    kpis: string[];
    tables: { name: string; keyColumns?: string[] }[];
    pbipPath?: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    hint?: string;
    available?: string[];
    log?: { tool: string; ok: boolean; result?: unknown; error?: string }[];
  }> {
    return req("/modeling/run", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  applyFullPageHTML(input: {
    pbipPath: string;
    html: string;
  }): Promise<{ ok: boolean; path: string }> {
    return req("/report/apply-html", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export { HELPER_URL };
