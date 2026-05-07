// Single-page HTML generator: erzeugt ein vollständiges Bericht-HTML, das
// als ein einziges page-fillendes HTML-Visual in PowerBI eingebettet wird.

import type { CIConfig, ProjectConfig } from "../types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ciVarsCss(ci: CIConfig): string {
  return `:root{
  --vibi-primary:${ci.colors.primary};
  --vibi-secondary:${ci.colors.secondary};
  --vibi-accent:${ci.colors.accent};
  --vibi-bg:${ci.colors.background};
  --vibi-text:${ci.colors.text};
  --vibi-font:${ci.fontFamily};
}`;
}

const PAGE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:var(--vibi-bg);color:var(--vibi-text);font-family:var(--vibi-font);overflow:hidden}
.report{display:grid;grid-template-rows:auto 1fr auto;height:100vh;padding:24px;gap:16px}
.header{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid var(--vibi-accent)}
.header h1{font-size:22px;font-weight:800}
.header .subtitle{font-size:12px;opacity:.7;margin-top:2px}
.header .logo{height:40px}
.body{display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:minmax(80px,auto);gap:12px;overflow:auto}
.kpi{grid-column:span 3;background:linear-gradient(135deg,var(--vibi-primary),var(--vibi-accent));color:#fff;padding:14px;border-radius:10px;display:flex;flex-direction:column;justify-content:space-between}
.kpi .label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.85}
.kpi .value{font-size:28px;font-weight:800;margin-top:4px}
.kpi .delta{font-size:11px;margin-top:4px;opacity:.9}
.card{grid-column:span 6;background:var(--vibi-bg);border:1px solid rgba(0,0,0,.08);border-radius:10px;padding:14px;display:flex;flex-direction:column}
.card.full{grid-column:span 12}
.card .title{font-weight:700;font-size:13px;margin-bottom:10px;color:var(--vibi-text)}
.bar{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px}
.bar .lbl{width:90px;opacity:.8}
.bar .track{flex:1;background:rgba(0,0,0,.06);border-radius:4px;height:12px;overflow:hidden}
.bar .fill{height:100%;background:var(--vibi-primary)}
.bar .num{width:60px;text-align:right;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;color:var(--vibi-secondary);opacity:.7;border-bottom:1px solid rgba(0,0,0,.1)}
td{padding:6px 8px;font-size:12px;border-bottom:1px solid rgba(0,0,0,.05)}
.footer{font-size:10px;opacity:.55;text-align:right;padding-top:8px;border-top:1px solid rgba(0,0,0,.06)}`;

function kpiCard(label: string, value: string, delta?: string): string {
  return `<div class="kpi">
  <div class="label">${escapeHtml(label)}</div>
  <div>
    <div class="value">${escapeHtml(value)}</div>
    ${delta ? `<div class="delta">${escapeHtml(delta)}</div>` : ""}
  </div>
</div>`;
}

function chartCard(title: string, data: { label: string; value: number }[]): string {
  const max = Math.max(1, ...data.map((d) => d.value));
  const bars = data
    .map((d) => {
      const pct = Math.round((d.value / max) * 100);
      return `<div class="bar"><div class="lbl">${escapeHtml(
        d.label
      )}</div><div class="track"><div class="fill" style="width:${pct}%"></div></div><div class="num">${d.value.toLocaleString(
        "de-DE"
      )}</div></div>`;
    })
    .join("");
  return `<div class="card"><div class="title">${escapeHtml(title)}</div>${bars}</div>`;
}

function tableCard(title: string, headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const tr = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="card"><div class="title">${escapeHtml(
    title
  )}</div><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

export function buildFullPageReport(project: ProjectConfig): string {
  const { ci, name, goal, kpis } = project;
  const kpiCards = (kpis.length ? kpis : ["Umsatz", "Marge", "Aufträge", "Standorte"])
    .slice(0, 4)
    .map((k, i) =>
      kpiCard(k, `${(1234 + i * 321).toLocaleString("de-DE")}`, "+8,4 %")
    )
    .join("\n");

  const logoHtml = ci.logoDataUrl
    ? `<img class="logo" src="${ci.logoDataUrl}" alt="" />`
    : "";

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><style>
${ciVarsCss(ci)}
${PAGE_CSS}
</style></head><body>
<div class="report">
  <header class="header">
    <div>
      <h1>${escapeHtml(name)}</h1>
      <div class="subtitle">${escapeHtml(goal)}</div>
    </div>
    ${logoHtml}
  </header>
  <main class="body">
    ${kpiCards}
    ${chartCard("Umsatz nach Standort", [
      { label: "Standort A", value: 12450 },
      { label: "Standort B", value: 9870 },
      { label: "Standort C", value: 5432 },
      { label: "Standort D", value: 3120 },
    ])}
    ${tableCard(
      "Top Artikel",
      ["Artikel", "Standort", "Menge", "Umsatz"],
      [
        ["Alpha", "Standort A", "1.240", "12.450 €"],
        ["Beta", "Standort B", "987", "9.870 €"],
        ["Gamma", "Standort C", "543", "5.432 €"],
      ]
    )}
  </main>
  <footer class="footer">Erstellt mit viBI · ${new Date().toLocaleDateString("de-DE")}</footer>
</div>
</body></html>`;
}

// Inline-Variante für PowerBI HTML-Visual: Style + Body-Inhalt ohne <html>/<body>.
export function inlineForHtmlVisual(fullPageHtml: string): string {
  // Strip <!doctype>, <html>, <head>, </head>, <body>, </body>, </html>
  // and keep only <style>...</style> + the inner <body> markup.
  const styleMatch = fullPageHtml.match(/<style>([\s\S]*?)<\/style>/);
  const bodyMatch = fullPageHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const style = styleMatch ? `<style>${styleMatch[1]}</style>` : "";
  const body = bodyMatch ? bodyMatch[1] : fullPageHtml;
  return `${style}${body}`;
}
