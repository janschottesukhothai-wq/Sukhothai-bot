import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import crypto from "crypto";
import { OpenAI } from "openai";
import { loadStore, topK } from "./vectorStore.js";
import { makeTransporter, sendTranscript } from "./mailer.js";

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS: mehrere Origins erlauben ---------- */
const ORIGINS = (process.env.ALLOWED_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // z.B. curl/SSR
      if (ORIGINS.includes("*") || ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
  })
);

app.use(bodyParser.json({ limit: "4mb" }));

/* ---------- Static Files (Widget) ---------- */
app.use("/public", express.static("public"));

/* ---------- OpenAI ---------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- Bot-Konfiguration ---------- */
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

/* ---------- (Optional) Retrieval ---------- */
async function embedText(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

async function retrieveContext(query, k = 6) {
  const store = loadStore();
  if (!store.items || !store.items.length) return "";
  const qvec = await embedText(query);
  const hits = topK(store, qvec, k);
  const blocks = hits.map(
    (h) => `# Quelle: ${h.meta?.source || "unbekannt"}\n${h.text}`
  );
  return blocks.join("\n\n");
}

/* ---------- LLM-Antwort mit robustem Fehler-Handling ---------- */
async function llmAnswer({ userMsg, history, context }) {
  const messages = [
    {
      role: "system",
      content: systemPrompt() + (context ? `\n\nKontext:\n${context}` : ""),
    },
    ...history,
    { role: "user", content: userMsg },
  ];

  try {
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
    });
    return chat.choices[0].message.content;
  } catch (e) {
    const msg =
      e?.response?.data?.error?.message ||
      e?.error?.message ||
      e?.message ||
      "LLM-Fehler";
    throw new Error(msg);
  }
}

function sanitizeHistory(history = []) {
  return history
    .filter((h) => h && h.role && h.content)
    .map((h) => ({ role: h.role, content: String(h.content).slice(0, 6000) }))
    .slice(-20);
}

/* ---------- Mail-Transport ---------- */
const transporter = makeTransporter({
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
});

/* ---------- Chat Endpoint ---------- */
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message fehlt" });
    }

    const threadId = crypto.randomBytes(4).toString("hex");
    const cleanHistory = sanitizeHistory(history);

    let context = "";
    try {
      context = await retrieveContext(message, 6);
    } catch (e) {
      console.warn("Kontextsuche fehlgeschlagen (fahre ohne Kontext fort):", e?.message);
    }

    const answer = await llmAnswer({
      userMsg: message,
      history: cleanHistory,
      context,
    });

    // Transcript per Mail (best effort)
    try {
      const subject = `[Sukhothai Bot] Chat #${threadId}`;
      const lines = [
        ...cleanHistory,
        { role: "user", content: message },
        { role: "assistant", content: answer },
      ]
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
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

/* ---------- Reservierungs-Endpoint ---------- */
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
        text,
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

/* ---------- Healthcheck ---------- */
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    hasKey: !!process.env.OPENAI_API_KEY,
    origins: ORIGINS,
  });
});

/* ---------- Root ---------- */
app.get("/", (_req, res) => {
  res.type("text/plain").send("Sukhothai Assist: OK");
});

app.listen(PORT, () => {
  console.log(`Sukhothai Assist läuft auf :${PORT}`);
});
