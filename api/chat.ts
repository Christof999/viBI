// Vercel Serverless Function (Node 20+).
// Proxies chat requests to the Google Gemini REST API.
// Keeps the API key server-side so it is never exposed to the browser.

interface IncomingMessage {
  role: "user" | "model";
  content: string;
}

interface IncomingTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface IncomingBody {
  messages: IncomingMessage[];
  tools?: IncomingTool[];
  systemPrompt?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: ({ text?: string } | { functionCall?: { name: string; args?: Record<string, unknown> } })[];
    };
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export default async function handler(
  req: { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (data: unknown) => void; end: () => void; send: (data: unknown) => void };
    setHeader: (k: string, v: string) => void;
  }
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "GEMINI_API_KEY ist nicht gesetzt. In den Vercel-Project-Settings unter Environment Variables ergänzen.",
    });
    return;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.0-pro";
  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as IncomingBody;
  if (!body?.messages?.length) {
    res.status(400).json({ error: "messages required" });
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload: Record<string, unknown> = {
    contents: body.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  };

  if (body.systemPrompt) {
    payload.systemInstruction = {
      role: "user",
      parts: [{ text: body.systemPrompt }],
    };
  }

  if (body.tools && body.tools.length > 0) {
    payload.tools = [
      {
        functionDeclarations: body.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        })),
      },
    ];
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    res.status(502).json({ error: `Gemini upstream nicht erreichbar: ${(e as Error).message}` });
    return;
  }

  const data = (await upstream.json().catch(() => ({}))) as GeminiResponse;

  if (!upstream.ok) {
    res.status(upstream.status).json({
      error: data.error?.message ?? `Gemini error ${upstream.status}`,
      hint:
        upstream.status === 404
          ? `Modell "${model}" nicht gefunden. GEMINI_MODEL ggf. auf gemini-2.5-pro setzen.`
          : undefined,
    });
    return;
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];

  for (const p of parts) {
    if ("text" in p && p.text) text += p.text;
    if ("functionCall" in p && p.functionCall) {
      toolCalls.push({
        id: Math.random().toString(36).slice(2, 10),
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
      });
    }
  }

  res.status(200).json({ text, toolCalls });
}
