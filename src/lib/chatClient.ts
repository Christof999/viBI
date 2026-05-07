import type { ChatMessage, MCPTool } from "../types";

interface ChatRequest {
  messages: { role: "user" | "model"; content: string }[];
  tools?: MCPTool[];
  systemPrompt?: string;
}

export interface ChatResponse {
  text: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

export async function callChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Chat API failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ChatResponse;
}

export function toApiMessages(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "model")
    .map((m) => ({ role: m.role as "user" | "model", content: m.content }));
}
