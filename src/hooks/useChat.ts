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
  const argDefaultsRef = useRef<Record<string, unknown>>({});

  const setExtraSystemPrompt = useCallback((text: string | null) => {
    extraSystemRef.current = text;
  }, []);

  const setToolArgDefaults = useCallback((defaults: Record<string, unknown>) => {
    argDefaultsRef.current = defaults;
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

      const MAX_STEPS = 8;
      let producedAnyText = false;
      const toolSummaries: string[] = [];
      try {
        let working = next;
        for (let step = 0; step < MAX_STEPS; step++) {
          const resp = await callChat({
            messages: toApiMessages(working),
            tools,
            systemPrompt: extraSystemRef.current
              ? `${SYSTEM_PROMPT}\n\n${extraSystemRef.current}`
              : SYSTEM_PROMPT,
          });

          if (resp.text) {
            producedAnyText = true;
            const botMsg: ChatMessage = {
              id: uid(),
              role: "model",
              content: resp.text,
            };
            working = [...working, botMsg];
            setMessages(working);
          }

          if (!resp.toolCalls || resp.toolCalls.length === 0) break;
          if (step === MAX_STEPS - 1) {
            // Letzter Loop-Durchlauf: KI hat noch Tool-Aufrufe geplant, aber wir
            // brechen ab, sonst läuft das endlos. Sichtbarer Hinweis im Chat.
            const stop: ChatMessage = {
              id: uid(),
              role: "model",
              content:
                `_(Maximale Tool-Aufruf-Tiefe (${MAX_STEPS}) erreicht – breche ab. ` +
                `Wenn du willst, dass ich weitermache, sag mir kurz „weiter".)_`,
            };
            working = [...working, stop];
            setMessages(working);
            break;
          }

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
            // Auto-fill any tool argument that the model omitted but matches a
            // known default (e.g. pbipPath of the active project). Schema
            // properties take precedence: only fill defaults that the tool
            // actually declares.
            const props =
              ((tool.inputSchema as { properties?: Record<string, unknown> } | undefined)
                ?.properties as Record<string, unknown> | undefined) ?? {};
            const mergedArgs: Record<string, unknown> = { ...call.args };
            for (const [k, v] of Object.entries(argDefaultsRef.current)) {
              if (k in props && (mergedArgs[k] === undefined || mergedArgs[k] === "")) {
                mergedArgs[k] = v;
              }
            }
            try {
              const { result } = await helper.callMCPTool(
                tool.server,
                call.name,
                mergedArgs
              );
              if (
                result &&
                typeof result === "object" &&
                "summary" in result &&
                typeof (result as { summary?: unknown }).summary === "string"
              ) {
                toolSummaries.push((result as { summary: string }).summary);
              }
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
        // Wenn die KI gar keinen Text produziert hat (alles waren nur
        // Tool-Aufrufe), legen wir einen kurzen Hinweis ins Chat – sonst
        // sieht der User nur ein paar JSON-Blöcke und denkt der Agent ist
        // hängengeblieben.
        if (!producedAnyText) {
          const empty: ChatMessage = {
            id: uid(),
            role: "model",
            content: toolSummaries.length
              ? `Tools sind durchgelaufen: ${toolSummaries[toolSummaries.length - 1]}`
              : "_(KI hat keine Zusammenfassung geliefert. Tools sind durchgelaufen – siehe Tool-Blöcke oben. Frag nach einer Zusammenfassung, wenn du eine Erklärung in Worten willst.)_",
          };
          working = [...working, empty];
          setMessages(working);
        }
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        const errMsg: ChatMessage = {
          id: uid(),
          role: "model",
          content: `⚠️ Fehler: ${msg}`,
        };
        setMessages((m) => [...m, errMsg]);
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

  return {
    messages,
    send,
    busy,
    error,
    reset,
    seedAssistant,
    setExtraSystemPrompt,
    setToolArgDefaults,
  };
}
