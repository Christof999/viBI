import type { CIConfig, HtmlSnippet, SnippetType } from "../types";

const uid = () => Math.random().toString(36).slice(2, 10);

export function ciToCss(ci: CIConfig): string {
  return `:root{
  --vibi-primary:${ci.colors.primary};
  --vibi-secondary:${ci.colors.secondary};
  --vibi-accent:${ci.colors.accent};
  --vibi-bg:${ci.colors.background};
  --vibi-text:${ci.colors.text};
  --vibi-font:${ci.fontFamily};
}
*{box-sizing:border-box}
body{margin:0;padding:16px;font-family:var(--vibi-font);background:var(--vibi-bg);color:var(--vibi-text)}`;
}

export function wrapForPreview(snippetHtml: string, ci: CIConfig): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${ciToCss(
    ci
  )}</style></head><body>${snippetHtml}</body></html>`;
}

export function exportForHtmlVisual(snippetHtml: string, ci: CIConfig): string {
  // PBI HTML Visual erwartet eine einzige Zelle mit komplettem HTML.
  // Inline-CSS, kein <html>/<body> Wrapper notwendig, aber Style-Block ja.
  return `<style>${ciToCss(ci)}</style>${snippetHtml}`;
}

export function makeKPI(label: string, value: string, delta?: string): string {
  return `<div style="padding:16px;border-radius:12px;background:linear-gradient(135deg,var(--vibi-primary) 0%,var(--vibi-accent) 100%);color:#fff;font-family:var(--vibi-font)">
  <div style="font-size:12px;opacity:.85;text-transform:uppercase;letter-spacing:.5px">${escapeHtml(
    label
  )}</div>
  <div style="font-size:32px;font-weight:800;margin-top:4px">${escapeHtml(value)}</div>
  ${delta ? `<div style="font-size:12px;margin-top:4px">${escapeHtml(delta)}</div>` : ""}
</div>`;
}

export function makeBarChart(title: string, data: { label: string; value: number }[]): string {
  const max = Math.max(1, ...data.map((d) => d.value));
  const bars = data
    .map((d) => {
      const pct = Math.round((d.value / max) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;font-size:13px">
  <div style="width:80px;color:var(--vibi-text);opacity:.8">${escapeHtml(d.label)}</div>
  <div style="flex:1;background:rgba(0,0,0,.06);border-radius:6px;height:14px;overflow:hidden">
    <div style="width:${pct}%;height:100%;background:var(--vibi-primary)"></div>
  </div>
  <div style="width:60px;text-align:right;font-variant-numeric:tabular-nums">${d.value.toLocaleString(
    "de-DE"
  )}</div>
</div>`;
    })
    .join("");
  return `<div style="padding:16px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#fff">
  <div style="font-weight:700;font-size:14px;margin-bottom:12px;color:var(--vibi-text)">${escapeHtml(
    title
  )}</div>
  <div style="display:flex;flex-direction:column;gap:8px">${bars}</div>
</div>`;
}

export function makeTable(headers: string[], rows: string[][]): string {
  const th = headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:8px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--vibi-text);opacity:.7;border-bottom:1px solid rgba(0,0,0,.1)">${escapeHtml(
          h
        )}</th>`
    )
    .join("");
  const tr = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c) =>
              `<td style="padding:8px 10px;font-size:13px;border-bottom:1px solid rgba(0,0,0,.06)">${escapeHtml(
                c
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<div style="padding:8px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#fff;overflow:auto">
  <table style="width:100%;border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
</div>`;
}

export function makeStarterSnippets(kpis: string[]): HtmlSnippet[] {
  const out: HtmlSnippet[] = [];
  kpis.slice(0, 4).forEach((k, i) => {
    out.push({
      id: uid(),
      name: k,
      type: "kpi",
      html: makeKPI(k, `${(1234 + i * 321).toLocaleString("de-DE")}`, "+8,4 %"),
    });
  });
  out.push({
    id: uid(),
    name: "Umsatz nach Region",
    type: "chart",
    html: makeBarChart("Umsatz nach Region", [
      { label: "EU", value: 12450 },
      { label: "US", value: 9870 },
      { label: "APAC", value: 5432 },
    ]),
  });
  out.push({
    id: uid(),
    name: "Top Produkte",
    type: "table",
    html: makeTable(
      ["Produkt", "Umsatz", "Marge"],
      [
        ["Alpha", "12.450 €", "32 %"],
        ["Beta", "9.870 €", "28 %"],
        ["Gamma", "5.432 €", "41 %"],
      ]
    ),
  });
  return out;
}

export function makeCustomSnippet(name: string, html: string): HtmlSnippet {
  return { id: uid(), name, type: "custom" as SnippetType, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
