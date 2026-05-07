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
  // Tool-Resultate werden als user-Nachricht zurückgespielt, damit Gemini im
  // nächsten Schritt darauf reagieren kann (sonst sieht das Modell nur die
  // ursprüngliche User-Frage und ruft das Tool im Loop immer wieder auf).
  return messages
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: `[Tool-Resultat: ${m.toolName ?? "unknown"}]\n${m.content}`,
        };
      }
      return { role: m.role as "user" | "model", content: m.content };
    })
    .filter((m) => m.role === "user" || m.role === "model");
}
