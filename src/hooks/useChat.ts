import { useCallback, useRef, useState } from "react";
import { callChat, toApiMessages } from "../lib/chatClient";
import { helper } from "../lib/helperClient";
import type { ChatMessage, MCPTool } from "../types";

const SYSTEM_PROMPT = `Du bist viBI, ein KI-Assistent für die Erstellung und Bearbeitung von PowerBI-Berichten.
Du hilfst dem Nutzer, Daten aufzubereiten, Datenmodelle zu entwerfen, DAX-Measures zu schreiben
und PBIP-Projekte zu generieren. Wenn passende Tools verfügbar sind, nutze sie.
Antworte standardmäßig auf Deutsch.`;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function useChat(tools: MCPTool[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraSystemRef = useRef<string | null>(null);

  const setExtraSystemPrompt = useCallback((text: string | null) => {
    extraSystemRef.current = text;
  }, []);

  const seedAssistant = useCallback((text: string) => {
    setMessages((m) => [...m, { id: uid(), role: "model", content: text }]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setError(null);
      const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
      const next = [...messages, userMsg];
      setMessages(next);
      setBusy(true);

      try {
        let working = next;
        // Simple agent loop: model -> optional tool calls -> model
        for (let step = 0; step < 4; step++) {
          const resp = await callChat({
            messages: toApiMessages(working),
            tools,
            systemPrompt: extraSystemRef.current
              ? `${SYSTEM_PROMPT}\n\n${extraSystemRef.current}`
              : SYSTEM_PROMPT,
          });

          if (resp.text) {
            const botMsg: ChatMessage = {
              id: uid(),
              role: "model",
              content: resp.text,
            };
            working = [...working, botMsg];
            setMessages(working);
          }

          if (!resp.toolCalls || resp.toolCalls.length === 0) break;

          for (const call of resp.toolCalls) {
            const tool = tools.find((t) => t.name === call.name);
            if (!tool) continue;
            const pending: ChatMessage = {
              id: uid(),
              role: "tool",
              toolName: call.name,
              content: "...",
              pending: true,
            };
            working = [...working, pending];
            setMessages(working);
            try {
              const { result } = await helper.callMCPTool(
                tool.server,
                call.name,
                call.args
              );
              const resultMsg: ChatMessage = {
                ...pending,
                content: JSON.stringify(result, null, 2),
                pending: false,
              };
              working = working.map((m) =>
                m.id === pending.id ? resultMsg : m
              );
              setMessages(working);
            } catch (e) {
              const errMsg: ChatMessage = {
                ...pending,
                content: `Fehler: ${(e as Error).message}`,
                pending: false,
              };
              working = working.map((m) => (m.id === pending.id ? errMsg : m));
              setMessages(working);
            }
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, tools]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, send, busy, error, reset, seedAssistant, setExtraSystemPrompt };
}
