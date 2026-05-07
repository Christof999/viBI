import type { TableSuggestion } from "../types";

export async function suggestTables(input: {
  description: string;
  reportName?: string;
  kpis?: string[];
}): Promise<TableSuggestion> {
  const r = await fetch("/api/suggest-tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error ?? `Fehler ${r.status}`);
  }
  return (await r.json()) as TableSuggestion;
}
