# Microsoft Power BI MCP – Setup für viBI

Der `pbi-report-builder`-Skill (siehe `SKILL.md`) beschreibt eine **Zwei-Schicht-Architektur**:

| Schicht | Werkzeug | Zuständig für |
|---------|----------|---------------|
| **Semantisches Modell** | `powerbi-modeling-mcp` (MCP-Server) | Tabellen, Spalten, Measures, Beziehungen, Partitionen, Rollen |
| **Report / Visuals** | viBI Built-in (`add_powerbi_page`) + Skill-Patterns | Pages, Visuals, Layout, Formatierung, Filter |

viBI bringt die Report-/Visual-Schicht selbst mit (siehe `helper/src/pbir.ts` + Tool `add_powerbi_page`). Damit die KI parallel auch das **lebende** Power-BI-Modell modifizieren kann (also Measures/Spalten/Beziehungen in einer **laufenden** Desktop-Instanz, statt nur auf TMDL-Dateien im Hintergrund), muss der offizielle **Microsoft Power BI MCP-Server** angebunden werden.

Dieses Dokument listet **alle Voraussetzungen** und zeigt, **wo du sie in viBI einträgst**.

---

## 1. Power BI Desktop vorbereiten

### 1.1 Preview-Features aktivieren

Öffne Power BI Desktop → **Datei → Optionen und Einstellungen → Optionen → Globale → Vorschaufeatures**. Aktiviere mindestens:

- ✅ **Power BI Projekte (.pbip) speichern** — sonst gibt es kein lesbares/schreibbares TMDL
- ✅ **TMDL-View** — gibt der KI bessere Selbstdiagnose
- ✅ **MCP Server** (heißt je nach Desktop-Version *„Model Context Protocol für Modellierung"* oder *„Local AI Tools"*)

Nach dem Aktivieren: **Desktop komplett schließen und neu starten** (Restart, nicht nur Datei zu).

### 1.2 XMLA-Read/Write aktivieren

Damit der MCP-Server in den Daten-Modell-Container des laufenden Desktops schreiben darf, muss der lokale Analysis-Services-Endpoint dafür freigeschaltet sein. Default-Pfad:

**Datei → Optionen und Einstellungen → Optionen → Global → Vorschaufeatures** → *„XMLA-Endpunkt schreibgeschützt für Power BI Premium und Power BI Pro"* oder analog *„Datenmodell-MCP-Endpunkt"*. Häkchen setzen.

> Hinweis: Microsoft benennt diese Option in jeder Major-Version leicht um. Wenn ihr sie nicht findet: in der Status-Leiste unten rechts auf das Versions-Label klicken, das interne Telemetry-Panel zeigt euch, ob der MCP-Endpunkt geladen wurde.

### 1.3 PBIP geöffnet halten

Der MCP-Server kommuniziert mit der laufenden Desktop-Instanz über die lokale AS-Workspace-Datei (Port unter `%LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\…\msmdsrv.port.txt`). Wenn Desktop nicht offen ist, **kann der MCP-Server nichts ändern** — viBI fällt automatisch auf die TMDL-Datei-Edits zurück.

---

## 2. MCP-Server installieren

Microsoft veröffentlicht den Server primär als **npm-Paket**. Stand SKILL.md heißt er `powerbi-modeling-mcp`. Welche genaue npm-ID gilt, hängt von der aktuellen Microsoft-Release ab (sie haben mehrere Vorabnamen genutzt: `@microsoft/mcp-fabric`, `@microsoft/powerbi-mcp`, `powerbi-modeling-mcp`).

So findest du den aktuell offiziellen Namen:

```powershell
npm search powerbi-modeling-mcp microsoft mcp powerbi
```

Wenn ihr ihn habt, **testen ohne viBI**:

```powershell
npx -y <paket-name>
```

Der Server sollte starten und im Terminal sagen *„Listening for MCP requests on stdio"* (oder ähnlich). Bei einem Error wegen "kein Desktop gefunden": Schritt 1.3 prüfen.

---

## 3. Auth / Token

Wenn der Server **rein lokal** mit deiner laufenden Desktop-Instanz arbeitet, braucht er keinen Token. Du bist als Windows-User schon authentifiziert.

Wenn der Server **gegen Fabric/Power BI Service** arbeiten soll (Fabric-Workspaces, Datasets in der Cloud), brauchst du:

1. **Microsoft Entra ID Anwendungsregistrierung** mit den Scopes `Dataset.ReadWrite.All` (XMLA Read/Write) und ggf. `Workspace.ReadWrite.All`
2. **Access Token** (Bearer) als Env-Variable

Token holen z.B. mit Azure CLI:

```powershell
az login
$env:REMOTE_MCP_AUTH = "Bearer " + (az account get-access-token --resource https://analysis.windows.net/powerbi/api --query accessToken -o tsv)
```

---

## 4. In viBI eintragen

viBI's Helper unterstützt drei MCP-Slots: `fabric`, `custom`, `remote`. Du setzt **Umgebungsvariablen vor dem Helper-Start**.

### Variante A: lokal-stdio (Microsoft Desktop)

```powershell
$env:FABRIC_MCP_COMMAND = "npx"
$env:FABRIC_MCP_ARGS    = "-y powerbi-modeling-mcp"   # echten Paketnamen einsetzen
cd $env:USERPROFILE\.vibi-helper
npm --prefix helper run build
npm --prefix helper start
```

Der Helper-Log sollte zeigen:

```
[mcp] fabric: verbunden via stdio (npx) (N Tools)
```

Im viBI-Header geht der Punkt **Fabric MCP** auf grün.

### Variante B: Remote / HTTP

Wenn Microsoft den Server als gehosteten HTTP-Endpunkt anbietet (Fabric):

```powershell
$env:REMOTE_MCP_URL  = "https://api.fabric.microsoft.com/v1/mcp"   # URL aus MS Docs
$env:REMOTE_MCP_AUTH = "Bearer <Entra-Access-Token>"
cd $env:USERPROFILE\.vibi-helper
npm --prefix helper start
```

Header zeigt dann **MS PBI Remote** grün.

### Variante C: Custom (eigenes Build)

Wenn du den Server aus dem Source baust:

```powershell
$env:CUSTOM_MCP_COMMAND = "node"
$env:CUSTOM_MCP_ARGS    = "C:/path/to/your/built/mcp.js"
```

---

## 5. Was viBI/Skill mit dem MCP macht

Sobald der MCP-Server verbunden ist, kommen seine Tools **zusätzlich** zu viBIs eingebauten Tools im Chat an (Helper-Endpoint `/mcp/tools` listet alle).

Typische Tools, die ein offizieller Power-BI-MCP exponiert (Namen variieren):

- `create_measure(table, name, expression, formatString?)`
- `update_measure(table, name, expression)`
- `create_relationship(fromTable, fromColumn, toTable, toColumn, isActive?)`
- `create_calculated_column(table, name, expression)`
- `refresh_table(table)`
- `evaluate_dax(expression)` — sehr nützlich zum Testen

viBIs System-Prompt instruiert die KI: **wenn der MCP-Server verbunden ist, NIMM die Live-Tools statt der TMDL-File-Tools** — das ist sicherer (kein File-Lock-Konflikt mit Desktop) und schneller (kein Reload nötig).

Wenn der MCP-Server **nicht** verbunden ist (z.B. weil Desktop zu war), nutzt die KI die viBI-eigenen TMDL-Schreibtools weiter (siehe SKILL.md „Workflow B").

---

## 6. Schnell-Check

Wenn alles steht, ruf in viBI-Chat:

> *„Liste alle verfügbaren KI-Tools auf"*

Antwort sollte u.a. enthalten:

- `server: "helper"` → viBI-eigene Tools (add_measure, add_powerbi_page, …)
- `server: "fabric"` (oder `remote`) → Microsoft-MCP-Tools

Wenn der MCP-Block fehlt, prüf den Helper-Log auf Fehler beim Start des Subprozesses (häufigste Ursachen: falscher Paketname, Desktop nicht offen, fehlender Preview-Feature-Toggle).

---

## 7. Bekannte Stolperfallen

| Symptom | Ursache | Fix |
|---------|---------|-----|
| Header zeigt MCP grau trotz Setup | Helper läuft seit vor dem `$env:`-Setzen | Helper-Prozess komplett killen und neu starten |
| MCP-Tools werden angezeigt aber jeder Aufruf endet mit "No PBIP loaded" | Desktop war zu kurz auf | Desktop offen halten **mit deinem .pbip geladen**, dann nochmal |
| Variation-Fehler beim Reload | Auto-Date-Schutz nicht eingehalten | viBIs eingebauter Schutz (siehe `helper/src/tmdl.ts` `isAutoDateTable`) greift bei den eigenen Tools; bei Microsoft-MCP-Tools musst du der KI sagen, sie soll keine LocalDateTable_* anfassen |
| Token läuft ab | Entra-Access-Tokens haben 1h Lifetime | Vor jedem Helper-Restart `az account get-access-token` neu holen |
