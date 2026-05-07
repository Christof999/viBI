# viBI

KI-gestützter PowerBI-Berichts-Designer. Web-App (React + Vite + Framer Motion) auf Vercel,
mit lokalem Windows-Helper für PowerBI Desktop, Dateisystem und MCP-Server-Anbindung.

## User-Flow

1. **Onboarding-Wizard** (8 Schritte, animiert)
   1. Welcome
   2. Helper-Setup mit Live-Statuscheck (Polling alle 2s) und Download-Button
   3. Berichtstyp – aktuell nur „Power BI Report" (PBIP); Paginated als Coming-soon
   4. Bericht-Name → wird auch Dateiname
   5. Ziel des Berichts
   6. Corporate Identity – Logo-Upload, Primär/Sekundär/Akzent/Hintergrund/Text-Farbe, Schriftart
   7. KPIs als Chips
   8. Zusammenfassung mit CI-Vorschau
2. **Modeling-Phase**
   1. **Tabellen-Vorschlag** – `/api/suggest-tables` ruft Gemini mit BC-Meta-Wissen, schlägt konkrete BC-Tabellen vor (Sales Invoice Header/Line, Item, Customer, Location …) inkl. Begründung und Schlüsselspalten
   2. Zwei Buttons:
      - **„Tabellen geladen"** → Helper ruft Microsoft-Fabric-MCP via `/modeling/run` auf (Heuristik wählt passende Tools für Beziehungen, Measures, Datumstabelle)
      - **„Andere Tabellen"** → Chat öffnet sich mit vorbelegtem Validierungs-Prompt gegen die Berichtsbeschreibung
   3. Chat hilft bei DAX, Power-Query, manueller Modellierung
3. **Übergang** – Klick auf „Modell fertig" liest Metadaten aus dem PBIP, schließt PBI Desktop
4. **Design-Phase** – **Ein einziges, page-fillendes HTML-Visual**. Editor + Live-Preview, „Kopieren" (für manuelles Einfügen) oder „In Bericht einbetten" (Helper schreibt das HTML-Visual direkt in `report.json`).

## Bibliothek (lokal auf dem User-PC)

Der Helper persistiert in `~/.vibi/library.json`:

- **Berichte** – jeder per Wizard erzeugte PBIP wird automatisch registriert (Pfad, CI, KPIs, Ziel, `lastOpenedAt`)
- **CI-Presets** – im Onboarding speicherbar und in späteren Berichten ladbar

Beim erneuten Öffnen sucht der Helper nach 3-stufiger Strategie:

1. gespeicherter `pbipPath` existiert noch → direkt öffnen
2. depth-limited Suche nach `<Name>.pbip` in `Documents`, `OneDrive\Documents`, `Desktop`, `C:\PowerBI` (registry wird mit gefundenem Pfad aktualisiert)
3. Fallback: Frontend fragt User per `prompt()` nach manuellem Pfad → wird im Anschluss in der Library gespeichert

## Architektur

```
┌─────────────────────────┐        ┌────────────────────────────┐
│  Browser (Vercel-App)   │        │  Vercel Serverless         │
│  React + Framer Motion  │ ─────▶ │  /api/chat → Gemini REST   │
│  Chat-Orchestrierung    │        │  (API-Key bleibt geheim)   │
└──────────┬──────────────┘        └────────────────────────────┘
           │ localhost:7321 (CORS)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  viBI Helper (Node, lokal auf Windows-PC)                   │
│   ├─ POST /powerbi/open   → startet PBIDesktop.exe          │
│   ├─ POST /pbip/save      → schreibt PBIP-Projekt           │
│   ├─ GET  /mcp/tools      → listet MCP-Tools                │
│   └─ POST /mcp/call       → ruft MCP-Tool auf               │
│                                                             │
│  MCP stdio-Clients:                                         │
│   ├─ Microsoft Fabric/PowerBI MCP                           │
│   └─ Eigener MCP-Server (später ergänzen)                   │
└─────────────────────────────────────────────────────────────┘
```

Der Browser kann aus Sandbox-Gründen weder PowerBI Desktop starten noch Dateien
auf der Festplatte ablegen – darum der lokale Helper. MCP-Server sprechen stdio,
weshalb sie ebenfalls lokal hinter dem Helper hängen statt auf Vercel.

## Technische Voraussetzungen

### Web-App / Build
- Node.js ≥ 20
- npm ≥ 10
- Account bei [Vercel](https://vercel.com) (für das Hosting)
- Google Gemini API Key – [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Lokaler Helper (Windows-PC)
- Windows 10/11
- Node.js ≥ 20
- PowerBI Desktop installiert (Standard-Pfad oder per `POWERBI_DESKTOP_PATH` setzen)
- Microsoft Fabric/PowerBI MCP-Server (optional – sobald MS ein offizielles Paket bereitstellt)
- Dein eigener MCP-Server (wird später dem Repo hinzugefügt)

> **Hinweis Gemini 3.0:** Zum Zeitpunkt des Setups ist `gemini-3.0-pro` möglicherweise
> noch nicht freigegeben. In dem Fall die Env-Variable `GEMINI_MODEL` auf
> `gemini-2.5-pro` (oder `gemini-2.5-flash`) setzen – kein Code-Change nötig.

## Projektstruktur

```
.
├── api/
│   └── chat.ts             # Vercel-Funktion: Gemini-Proxy
├── src/                    # React-App
│   ├── components/         # Header, Sidebar, ReportCanvas, ChatPanel
│   ├── hooks/useChat.ts    # Agent-Loop (LLM + Tool-Dispatch)
│   ├── lib/                # helperClient, chatClient, pbip
│   └── App.tsx
├── helper/                 # Lokaler Windows-Helper (Node/Express)
│   ├── src/index.ts
│   ├── src/mcp.ts          # MCP-Client-Registry
│   └── src/pbip.ts         # PBIP-Writer
├── vercel.json
├── .env.example
└── helper/.env.example
```

## Setup

### 1. Repository klonen & Abhängigkeiten installieren

```bash
git clone <repo>
cd viBI
npm install
npm --prefix helper install
```

### 2. Environment-Variablen

Web-App (`.env.local`):
```
VITE_HELPER_URL=http://localhost:7321
VITE_DEFAULT_PBIP_DIR=C:\PowerBI\viBI
```

Helper (`helper/.env`):
```
PORT=7321
CORS_ORIGIN=http://localhost:5173,https://your-app.vercel.app
ALLOWED_WRITE_ROOTS=C:/PowerBI
# FABRIC_MCP_COMMAND=npx
# FABRIC_MCP_ARGS=-y @microsoft/mcp-fabric
# CUSTOM_MCP_COMMAND=node
# CUSTOM_MCP_ARGS=../mcp-server/dist/index.js
```

### 3. Lokal starten

In zwei Terminals:

```bash
# Terminal A: Helper
npm run helper:dev

# Terminal B: Web-App
npm run dev
```

App öffnet auf <http://localhost:5173>, Helper auf <http://localhost:7321>.

### 4. Auf Vercel deployen

```bash
npx vercel
```

Im Vercel-Dashboard unter **Project → Settings → Environment Variables** setzen:

| Variable               | Beschreibung                                | Scope             |
| ---------------------- | ------------------------------------------- | ----------------- |
| `GEMINI_API_KEY`       | Google Gemini API Key                       | Production/Preview |
| `GEMINI_MODEL`         | z.B. `gemini-3.0-pro` oder `gemini-2.5-pro` | Production/Preview |
| `VITE_HELPER_URL`      | `http://localhost:7321`                     | Production/Preview |
| `VITE_DEFAULT_PBIP_DIR`| z.B. `C:\PowerBI\viBI`                      | Production/Preview |

> Variablen mit `VITE_`-Präfix werden zur Build-Zeit ins Browser-Bundle gebacken;
> reine Server-Variablen (`GEMINI_API_KEY`) bleiben in der Serverless-Funktion.

### 5. Helper auf dem Windows-PC laufen lassen

```bash
cd helper
npm run build
npm start
```

Optional als Windows-Dienst hinterlegen (z. B. via `nssm`).

## Eigenen MCP-Server ergänzen

Später z. B. ein `mcp-server/`-Unterordner. Helper anpassen:
```
CUSTOM_MCP_COMMAND=node
CUSTOM_MCP_ARGS=../mcp-server/dist/index.js
```
Tools tauchen automatisch im UI und im Chat-Tool-Dispatch auf.

## Sicherheits-Hinweise

- Der Helper schreibt nur in Pfade unter `ALLOWED_WRITE_ROOTS`.
- Der Gemini-API-Key liegt **ausschließlich** in der Vercel-Funktion, nie im Browser.
- CORS ist eng konfiguriert (`localhost:5173` + deine Vercel-Domain).
- Vor Produktiv-Einsatz ggf. zusätzlich eine Bearer-Token-Auth zwischen App und Helper einbauen.
