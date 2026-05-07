import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onReset: () => void;
}

export function ChatPanel({ messages, busy, error, onSend, onReset }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const submit = () => {
    if (!input.trim() || busy) return;
    onSend(input);
    setInput("");
  };

  return (
    <motion.aside
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
      style={{
        width: 380,
        borderLeft: "1px solid var(--border)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>KI-Assistent</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Gemini</div>
        </div>
        <button onClick={onReset} disabled={busy}>
          Neu
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}
          >
            Frag z. B.:
            <ul style={{ paddingLeft: 18, marginTop: 8 }}>
              <li>„Erstelle ein Datenmodell für Verkaufszahlen."</li>
              <li>„Schreibe ein DAX-Measure für YoY-Wachstum."</li>
              <li>„Bereinige die Spalte ‚Region' (Trim, Title-Case)."</li>
              <li>„Speichere das Projekt als PBIP."</li>
            </ul>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                marginBottom: 10,
                background:
                  m.role === "user"
                    ? "var(--user)"
                    : m.role === "tool"
                      ? "#142016"
                      : "var(--bot)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {m.role === "tool"
                  ? `Tool · ${m.toolName ?? ""}`
                  : m.role === "user"
                    ? "Du"
                    : "viBI"}
              </div>
              {m.pending ? <em style={{ color: "var(--muted)" }}>läuft…</em> : m.content}
            </motion.div>
          ))}
        </AnimatePresence>

        {busy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ fontSize: 12, color: "var(--muted)" }}
          >
            <span>denke nach</span>
            <motion.span
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              …
            </motion.span>
          </motion.div>
        )}

        {error && (
          <div
            style={{
              marginTop: 8,
              color: "var(--danger)",
              fontSize: 12,
              border: "1px solid var(--danger)",
              padding: 8,
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
        }}
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Nachricht an viBI… (Enter zum Senden, Shift+Enter für neue Zeile)"
          style={{ resize: "none" }}
        />
        <button className="primary" onClick={submit} disabled={busy}>
          ➤
        </button>
      </div>
    </motion.aside>
  );
}
