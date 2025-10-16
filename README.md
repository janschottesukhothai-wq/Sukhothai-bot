# Sukhothai Assist – Live-Agent (DSGVO-konform, selbst gehostet)

**Features**
- Chat-Widget (2 Zeilen Einbindung)
- Antworten aus Website + Dateien (RAG)
- Gesprächs-Weiterleitung per E-Mail
- Reservierungs-Form (Lead-Erfassung)
- Ton: klar, freundlich, kein Gendern
- Einfache Ingestion (URL-Liste + Markdown/Docs)

## 1) Setup

```bash
cp .env.example .env
# ENV-Werte eintragen (OpenAI, SMTP, EMAILS, SEED_URLS, ALLOWED_ORIGIN)
npm install
```

## 2) Wissensbasis aufbauen

- Seed-Datei: `data/seed_faqs.md` bearbeiten.
- URLs in `.env` bei `SEED_URLS` eintragen (mit Komma trennen).
- Dann:

```bash
npm run ingest
```

Ergebnis: `data/embeddings.json`

## 3) Starten

```bash
npm run dev
# Server auf http://localhost:3000
```

## 4) Einbindung auf der Website

Variante A (eigene Seite, testen):
- Öffne: `http://localhost:3000/public/embed.html`

Variante B (Widget in bestehender Seite):
```html
<script>window.SUKH_TALK_API="https://DEINE-DOMAIN/chat";</script>
<script src="https://DEINE-DOMAIN/public/widget.js" defer></script>
```

## 5) Endpoints

### POST /chat
Body:
```json
{ "message": "Habt ihr heute Mittag offen?", "history": [ { "role":"user","content":"..." } ] }
```
Antwort:
```json
{ "ok": true, "answer": "...", "threadId": "abcd1234" }
```

### POST /reserve
Body:
```json
{
  "name":"Max Mustermann",
  "phone":"+49...",
  "persons":2,
  "date":"2025-10-16",
  "time":"19:30",
  "note":"ruhiger Tisch"
}
```
Antwort:
```json
{ "ok": true, "msg": "Erfasst. Wir melden uns." }
```

## 6) Docker

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm i --omit=dev
COPY . .
EXPOSE 3000
CMD ["node","server.js"]
```

Build & Run:
```bash
docker build -t sukhothai-assist .
docker run --env-file=.env -p 3000:3000 sukhothai-assist
```

## 7) DSGVO-Hinweis (Beispiel)

> Dieses Chat-Widget speichert die von Ihnen eingegebenen Inhalte zur Bearbeitung Ihrer Anfrage. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Die Daten werden nach 30 Tagen automatisiert gelöscht. Details in unserer [Datenschutzerklärung].

## 8) Tipps
- Antworten kurz halten. Bei Unsicherheit Rückfragen stellen.
- Reservierungen nicht bestätigen – Leads per E-Mail.

*Made for Sukhothai Sprockhövel.*

---

## WordPress – Einbindung (Widget)

**Variante A: Custom HTML Block (Site Editor / Footer)**
1. WP-Admin → „Design“ → „Editor“ (Site Editor) → „Fußzeile“ bearbeiten.
2. „+“ → „Individuelles HTML“ Block hinzufügen.
3. Folgenden Code einfügen (Domain anpassen):
```html
<script>window.SUKH_TALK_API="https://bot.sukhothai-sprockhoevel.de/chat";</script>
<script src="https://bot.sukhothai-sprockhoevel.de/public/widget.js" defer></script>
```
4. Speichern → Seite neu laden → Chat-Bubble unten rechts.

**Variante B: Plugin „Header Footer Code Manager“ oder „Insert Headers and Footers“**
1. Plugin installieren & aktivieren.
2. „Add New Snippet“ → Location: **Footer** → Site Display: **Entire Site**.
3. Gleichen Code wie oben einfügen.
4. Speichern.

**Hinweise**
- Setze in `.env` des Bot-Servers `ALLOWED_ORIGIN=https://sukhothai-sprockhoevel.de`.
- Wenn der Bot unter einer Subdomain läuft (z. B. `bot.sukhothai-sprockhoevel.de`), richte DNS + Reverse Proxy ein.
- Nach Änderungen an Inhalten: `npm run ingest` ausführen, damit der Bot die neuen Daten nutzt.
