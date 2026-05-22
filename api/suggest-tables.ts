// Vercel Serverless Function: schlägt Quelltabellen für eine Bericht-Beschreibung vor.
// System-Prompt schlägt passende Quelltabellen vor, ohne eine Datenquelle
// verbindlich zu erzwingen. Business Central ist ein häufiger Fall, aber nicht
// die einzige erlaubte Modellwelt.

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

const SYSTEM_PROMPT = `Du bist viBI's Datenmodellierungs-Assistent.

Kontext:
- Der User kann Daten aus Business Central, OData, Fabric, SQL, Excel oder beliebigen PowerBI-Quellen verwenden.
- Business Central ist ein häufiger Fall. Wenn die Beschreibung eindeutig nach BC/ERP klingt, darfst du passende BC-Standardentitäten vorschlagen.
- Wenn die Beschreibung allgemeiner ist oder auf andere Daten deutet, schlage generische oder quellenspezifische Tabellen vor (z.B. Orders, Products, Customers, Tickets, Assets, Projects, LedgerEntries).
- Später ist ausschließlich das tatsächlich in PowerBI geladene Modell maßgeblich; diese Vorschläge sind nur eine Ladehilfe.

Aufgabe: Für die Berichtsbeschreibung des Users schlägst du die minimal nötigen Tabellen vor, die der User in Power BI Desktop laden soll. Pro Tabelle:
- name: passender Tabellen-/Entitätsname
- source: konkrete Quelle, falls erkennbar, sonst "Power BI data source"
- purpose: ein Satz, warum diese Tabelle für die Anforderung gebraucht wird
- keyColumns: 3-6 Spalten, die für das Modell wichtig sind

Antworte AUSSCHLIESSLICH als gültiges JSON in diesem Schema:
{"tables":[{"name":"…","source":"Power BI data source","purpose":"…","keyColumns":["…"]}],"rationale":"kurzer Absatz, warum genau diese Tabellen"}

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
