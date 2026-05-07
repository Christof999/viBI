// Vercel Serverless Function: schlägt Quelltabellen für eine Bericht-Beschreibung vor.
// System-Prompt verankert das Meta-Wissen, dass alle Niederlassungen Microsoft
// Dynamics 365 Business Central nutzen – die KI darf BC-Tabellen direkt
// vorschlagen, ohne nachzufragen.

interface IncomingBody {
  description: string;
  reportName?: string;
  kpis?: string[];
}

interface SuggestedTable {
  name: string;
  source: string;
  purpose: string;
  keyColumns: string[];
}

interface Suggestion {
  tables: SuggestedTable[];
  rationale: string;
}

const SYSTEM_PROMPT = `Du bist viBI's Datenmodellierungs-Assistent. Meta-Kontext, den du als gesetzt annimmst:
- Alle Niederlassungen des Users nutzen Microsoft Dynamics 365 Business Central als ERP.
- BC liefert Daten via Web Services / OData / Fabric Mirroring – Tabellennamen entsprechen den BC-Standardentitäten.
- Häufige BC-Tabellen für Vertriebs-/Absatzanalysen: Sales Invoice Header, Sales Invoice Line, Sales Cr.Memo Header, Sales Cr.Memo Line, Item, Item Category, Customer, Location, Sales Person/Purchaser, Posting Date.
- Für Einkauf: Purchase Invoice Header/Line, Vendor.
- Für Finanzen: G/L Entry, G/L Account, Dimension Set Entry.
- Für Lager: Item Ledger Entry, Bin, Warehouse Entry.

Aufgabe: Für die Berichtsbeschreibung des Users schlägst du die minimal nötigen BC-Tabellen vor, die der User in Power BI Desktop laden soll. Pro Tabelle:
- name: BC-Standardname (englisch, wie in BC angezeigt)
- source: "Business Central" (oder konkretere Quelle, falls eindeutig)
- purpose: ein Satz, warum diese Tabelle für die Anforderung gebraucht wird
- keyColumns: 3-6 Spalten, die für das Modell wichtig sind

Antworte AUSSCHLIESSLICH als gültiges JSON in diesem Schema:
{"tables":[{"name":"…","source":"Business Central","purpose":"…","keyColumns":["…"]}],"rationale":"kurzer Absatz, warum genau diese Tabellen"}

Keine Markdown-Codefences, kein zusätzlicher Text.`;

export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => { json: (data: unknown) => void };
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
    res.status(500).json({ error: "GEMINI_API_KEY fehlt" });
    return;
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as IncomingBody;
  if (!body?.description) {
    res.status(400).json({ error: "description erforderlich" });
    return;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.0-pro";
  const userPrompt = `Bericht-Name: ${body.reportName ?? "unbenannt"}
Beschreibung: ${body.description}
Geplante KPIs: ${(body.kpis ?? []).join(", ") || "keine angegeben"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    res.status(502).json({ error: `Gemini nicht erreichbar: ${(e as Error).message}` });
    return;
  }

  const data = (await upstream.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };

  if (!upstream.ok) {
    res.status(upstream.status).json({ error: data.error?.message ?? "Gemini error" });
    return;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const json = text.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();

  try {
    const parsed = JSON.parse(json) as Suggestion;
    if (!Array.isArray(parsed.tables)) throw new Error("kein tables-Array");
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({
      error: `Konnte Vorschläge nicht parsen: ${(e as Error).message}`,
      raw: text,
    });
  }
}
