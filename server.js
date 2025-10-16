import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import crypto from "crypto";
import { OpenAI } from "openai";
// Optional – Retrieval ist standardmäßig AUS für maximale Geschwindigkeit
// import { loadStore, topK } from "./vectorStore.js";
import { makeTransporter, sendTranscript } from "./mailer.js";

const app = express();
const PORT = process.env.PORT || 3000;

console.log("🚀 Neuer Build gestartet (fast mode)");

// ---------- Tuning-Flags ----------
const ENABLE_RETRIEVAL = false;        // <- für maximale Geschwindigkeit AUS
const MAX_COMPLETION_TOKENS = 250;     // -> kürzere Antworten = schneller
const MAX_TURNS = 10;                   // -> nur die letzten 10 Chat-Turns

// ---------- CORS: mehrere Origins erlauben ----------
const ORIGINS = (process.env.ALLOWED_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // z. B. curl/SSR
      if (ORIGINS.includes("*") || ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
  })
);

app.use(bodyParser.json({ limit: "4mb" }));

// ---------- Static Files (Widget) ----------
app.use("/public", express.static("public"));

// ---------- OpenAI ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Bot-Konfiguration ----------
const BOT_CONFIG = {
  name: "Sukhothai Assist",
  style: "klar, freundlich, keine Floskeln, kein Gendern",
  openingHours: {
    mon: "17:30-23:00",
    tue: "17:30-23:00",
    wed: "17:30-23:00",
    thu: "17:30-23:00",
    fri: "17:30-23:00",
    sat: "17:30-23:00",
    sun: "12:00-14:30, 17:30-23:00",
  },
  bookingPolicy:
    "Reservierungen werden nicht final bestätigt. Kontaktdaten aufnehmen und per Mail senden.",
  address: "Bochumer Straße 15, 45549 Sprockhövel",
};

function systemPrompt() {
  return [
    `Du bist der Live-Agent für das Thai-Restaurant "Sukhothai".`,
    `Sprache: Deutsch. Stil: ${BOT_CONFIG.style}.`,
    `Regeln:`,
    `- Keine Zusagen, die du nicht sicher weißt.`,
    `- Wenn unklar: Rückfragen stellen.`,
    `- Reservierungen nie final bestätigen. Immer Kontaktdaten aufnehmen.`,
    `Öffnungszeiten: ${JSON.stringify(BOT_CONFIG.openingHours)}`,
    `Adresse: ${BOT_CONFIG.address}`,
    `Wenn möglich, kurze klare Sätze. Keine Füllwörter.`,
  ].join("\n");
}

// ---------- (Optional) Retrieval (deaktiviert) ----------
/*
async function embedText(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

async function retrieveContext(query, k = 3) {
  const store = loadStore();
  if (!store.items || !store.items.length) return "";
  const qvec = await embedText(query);
  const hits = topK(store, qvec, k);
  const blocks = hits.map(
    (h) => `# Quelle: ${h.meta?.source || "unbekannt"}\n${h.text}`
  );
  return blocks.join("\n\n");
}
*/

// ---------- Verlauf säubern / kürzen ----------
function sanitizeHistory(history = []) {
  return history
    .filter(h => h && h.role && h.content)
    .map(h => ({
      role: h.role,
      // harte Kürzung der Länge pro Nachricht – hält den Prompt klein
      content: String(h.content).slice(0, 1200)
    }))
    .slice(-MAX_TURNS * 2); // user+assistant pro Turn
}

// ---------- LLM-Antwort mit Fallback ----------
async function llmAnswer({ userMsg, history, context }) {
  const messages = [
    {
      role: "system",
      content: systemPrompt() + (context ? `\n\nKontext:\n${context}` : ""),
    },
    ...history,
    { role: "user", content: userMsg },
  ];

  async function callModel(model) {
    const resp = await openai.chat.completions.create({
      model,
      messages,
      // GPT-5-Modelle: KEINE temperature; optional Outputlimit:
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });
    return resp.choices[0].message.content;
  }

  // 1) Schnell & günstig
  const primary = "gpt-5-mini";
  // 2) Robuster Fallback
  const fallback = "gpt-4o-mini";

  try {
    return await callModel(primary);
  } catch (e1) {
    const msg1 = e1?.response?.data?.error?.message || e1?.message || String(e1);
    console.warn(`LLM PRIMARY (${primary}) failed:`, msg1);

    // Nur bei „modellbezogenen“ Fehlern auf Fallback gehen
    const shouldFallback = /model|unsupported|Unknown|not\s+found|unavailable/i.test(msg1);
    if (!shouldFallback) throw new Error(msg1);

    try {
      // Beim Fallback akzeptieren wir default temperature (0.2 ist ok),
      // setzen aber KEINE, um kompatibel zu bleiben.
      return await callModel(fallback);
    } catch (e2) {
      const msg2 = e2?.response?.data?.error?.message || e2?.message || String(e2);
      throw new Error(`Fallback (${fallback}) failed: ${msg2}`);
    }
  }
}

// ---------- Mail-Transport ----------
const transporter = makeTransporter({
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
});

// ---------- Chat Endpoint ----------
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message fehlt" });
    }

    const threadId = crypto.randomBytes(4).toString("hex");
    const cleanHistory = sanitizeHistory(history);

    let context = "";
    if (ENABLE_RETRIEVAL) {
      try {
        // context = await retrieveContext(message, 3); // kleiner k -> schneller
        context = ""; // optional – hier deaktiviert
      } catch (e) {
        console.warn("Kontextsuche fehlgeschlagen (ohne Kontext weiter):", e?.message);
      }
    }

    const answer = await llmAnswer({ userMsg: message, history: cleanHistory, context });

    // Transcript per Mail (best effort, blockiert Antwort nicht)
    (async () => {
      try {
        const subject = `[Sukhothai Bot] Chat #${threadId}`;
        const lines = [
          ...cleanHistory,
          { role: "user", content: message },
          { role: "assistant", content: answer },
        ]
          .map(m => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n");

        await sendTranscript(transporter, {
          from: process.env.EMAIL_FROM,
          to: process.env.EMAIL_TO,
          subject,
          text: lines,
        });
      } catch (err) {
        console.error("Mailfehler:", err?.message);
      }
    })();

    return res.json({ ok: true, answer, threadId });
  } catch (e) {
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Chat fehlgeschlagen";
    console.error("CHAT ERROR:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ---------- Reservierungs-Endpoint ----------
app.post("/reserve", async (req, res) => {
  try {
    const { name, phone, persons, date, time, note } = req.body || {};
    if (!name || !phone || !persons || !date || !time) {
      return res.status(400).json({ ok: false, error: "Felder fehlen" });
    }

    const subject = `[Sukhothai Reservierung] ${date} ${time} – ${persons} Pers.`;
    const text = [
      `Neue Reservierungsanfrage:`,
      `Name: ${name}`,
      `Telefon: ${phone}`,
      `Personen: ${persons}`,
      `Datum: ${date}`,
      `Uhrzeit: ${time}`,
      `Notiz: ${note || "-"}`,
    ].join("\n");

    try {
      await sendTranscript(transporter, {
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject,
        text
      });
    } catch (err) {
      console.error("Mailfehler Reserve:", err?.message);
    }
    return res.json({ ok: true, msg: "Erfasst. Wir melden uns." });
  } catch (e) {
    const msg = e?.message || "Reservierung fehlgeschlagen";
    console.error("RESERVE ERROR:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ---------- Healthcheck ----------
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    hasKey: !!process.env.OPENAI_API_KEY,
    origins: ORIGINS,
    fastMode: !ENABLE_RETRIEVAL,
    version: "status-" + new Date().toISOString(),
  });
});

// ---------- Modell-/Status-Test ----------
app.get("/status", async (_req, res) => {
  try {
    const chat = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Sag nur deinen Modellnamen." }],
      max_completion_tokens: 16 // kleiner = schneller
    });

    return res.json({
      ok: true,
      model: "gpt-5-mini",
      reply: chat.choices[0].message.content,
    });
  } catch (e) {
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Status-Test fehlgeschlagen";
    console.error("STATUS ERROR:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ---------- Root ----------
app.get("/", (_req, res) => {
  res.type("text/plain").send("Sukhothai Assist: OK");
});

app.listen(PORT, () => {
  console.log(`Sukhothai Assist läuft auf :${PORT}`);
});
