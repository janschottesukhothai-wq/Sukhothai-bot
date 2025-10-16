// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import crypto from "crypto";
import { OpenAI } from "openai";
// Retrieval bewusst deaktiviert (für Speed). Später optional einschalten.
// import { loadStore, topK } from "./vectorStore.js";
import { makeTransporter, sendTranscript } from "./mailer.js";

const app = express();
const PORT = process.env.PORT || 3000;

console.log("🚀 Build gestartet – Fast Mode mit FAQ-Layer");

// =============================
// Tuning
// =============================
const ENABLE_RETRIEVAL = false;      // für maximale Geschwindigkeit AUS
const MAX_COMPLETION_TOKENS = 250;   // kürzere Antworten = schneller
const MAX_TURNS = 10;                // nur letzte 10 Chat-Turns (user+assistant)

// =============================
// CORS (mehrere Origins erlaubt)
// =============================
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

// =============================
// Static Files (Widget)
// =============================
app.use("/public", express.static("public"));

// =============================
// OpenAI
// =============================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =============================
// Bot-Konfiguration
// =============================
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
    `Nützliche Links (falls relevant, kurz verlinken):`,
    `- Karte: https://www.sukhothai-sprockhoevel.de/karte/`,
    `- Google Maps: https://maps.app.goo.gl/AnSHY9QvbdWJpZYeA`,
    `- Gutschein: https://www.yovite.com/Restaurant-Gutschein-R-84849891.html?REF=REST`,
    `Wenn möglich, kurze klare Sätze. Keine Füllwörter.`,
  ].join("\n");
}

// =============================
// FAQ / Sofort-Antworten (kein LLM)
// =============================
const FAQ = [
  // Reservations & Bookings
  {
    id: "cancel-policy",
    patterns: [/cancel|storn|absag/i],
    answer:
      "Stornierungen sind bis 1 Stunde vor Öffnung möglich. Für Gruppen ab 10 Personen fällt bei Nichterscheinen oder Reduzierung €10 pro Person an."
  },
  {
    id: "walk-in",
    patterns: [/walk.?in|spontan|ohne reserv|vorbei kommen|einfach kommen/i],
    answer: "Für Walk-ins halten wir keine Tische frei."
  },
  {
    id: "deposit",
    patterns: [/anzahl|deposit|kaution|kreditkarte|sicherheitsleistung/i],
    answer:
      "Nur für Gruppen ab 10 Personen benötigen wir eine Kreditkarten-Sicherung."
  },

  // Menu & Food
  {
    id: "menu-general",
    patterns: [/menü|karte|speisekarte|gerichte|essen/i],
    answer:
      "Ich habe keinen Einblick in die tagesaktuelle Karte. Gern der Online-Menülink: https://www.sukhothai-sprockhoevel.de/karte/"
  },
  {
    id: "dietary",
    patterns: [/vegan|vegetar|gluten|halal|laktos|allerg/i],
    answer:
      "Vegetarische, vegane und glutenfreie Optionen sind verfügbar. Hier ist die Karte: https://www.sukhothai-sprockhoevel.de/karte/"
  },
  {
    id: "kids",
    patterns: [/kinder|kindermen|kids/i],
    answer:
      "Ja, es gibt Kindermenüs: vegane Nuggets mit Pommes, vegane Bratnudeln mit Gemüse, Pommes mit Ketchup sowie kleine Ente süß-sauer mit Reis."
  },
  {
    id: "bring-own",
    patterns: [/eigen(es|e)|mitbringen|eigene(n)? (kuchen|torte|speisen|getränk)/i],
    answer:
      "Nur nach vorheriger Absprache. Soll ich dich direkt mit dem Restaurant verbinden?"
  },
  {
    id: "xmas-hours",
    patterns: [/weihnacht/i],
    answer:
      "An beiden Weihnachtsfeiertagen geöffnet: 12:00–14:30 und 17:30–21:30."
  },

  // Location & Accessibility
  {
    id: "maps",
    patterns: [/wo seid|adresse|wie (komm|finde)|navigat|karte google/i],
    answer:
      "Hier ist der Google-Maps-Link: https://maps.app.goo.gl/AnSHY9QvbdWJpZYeA"
  },
  {
    id: "parking",
    patterns: [/park(en|platz)|parkmöglichkeit/i],
    answer:
      "Kostenlose Parkplätze sind direkt vor dem Restaurant oder in der Nähe verfügbar."
  },
  {
    id: "wheelchair",
    patterns: [/rollstuhl|barrierefrei|behindertengerecht|behinderten WC|barriere/i],
    answer:
      "Leider nein – das Restaurant ist nicht rollstuhlgerecht und es gibt keine barrierefreie Toilette."
  },
  {
    id: "public-transport",
    patterns: [/bus|bahn|öffentliche(n)? verkehr|ÖPNV|zug/i],
    answer:
      "Ja, der Sprockhövel Busbahnhof ist in der Nähe."
  },

  // Other
  {
    id: "pets",
    patterns: [/hund|haustier|tier|pet/i],
    answer:
      "Haustiere sind willkommen – wir servieren frisches Wasser und einen Keks."
  },
  {
    id: "giftcards",
    patterns: [/gutschein|gift ?card/i],
    answer:
      "Ja, Gutscheine gibt es vor Ort oder online. Link: https://www.yovite.com/Restaurant-Gutschein-R-84849891.html?REF=REST"
  },
  {
    id: "amenities",
    patterns: [/kinderstuhl|hochstuhl|terrasse|außen|draussen|außensitz/i],
    answer:
      "Ja – es gibt Hochstühle und eine Terrasse."
  },
  {
    id: "contact",
    patterns: [/kontakt|erreichen|frage(n)? stellen|email|mail/i],
    answer:
      "Am besten per E-Mail an info@sukhothai-sprockhoevel.de."
  },
  {
    id: "email-confirm",
    patterns: [/bestätig.*(mail|e-?mail)|reservierungsbestät/i],
    answer:
      "Eine E-Mail-Bestätigung gibt es nur bei Online-Reservierung. Am Telefon senden wir die Bestätigung per WhatsApp."
  },
  {
    id: "catering",
    patterns: [/cater|lieferservice|veranstaltung|feier/i],
    answer:
      "Ja, Catering ab 15 Personen im Ennepe-Ruhr-Kreis. Bitte Details per E-Mail an info@sukhothai-sprockhoevel.de senden."
  },
  {
    id: "outdoor",
    patterns: [/außen|terrasse|draußen|biergarten/i],
    answer:
      "Ja, wir haben eine Terrasse."
  },
  {
    id: "payments",
    patterns: [/karte|kreditkarte|ec|mastercard|visa|apple|google pay|paypal/i],
    answer:
      "Wir akzeptieren EC, Visa, American Express, Mastercard, Apple Pay, Google Pay & PayPal."
  },
  {
    id: "ev-charging",
    patterns: [/lade(gerät|station)|elektro(auto|fahrzeug)/i],
    answer:
      "Ladestationen sind derzeit nicht verfügbar."
  },
  {
    id: "cooking-class",
    patterns: [/koch(kurs|schule)/i],
    answer:
      "Dieses Jahr finden keine Kochkurse statt."
  },
  {
    id: "capacity",
    patterns: [/wie viele gäste|kapazität|plätze|personen/i],
    answer:
      "Bis zu 80 Sitzplätze im Restaurant. Private Veranstaltungen bis 36 Personen in einem separaten Raum."
  },
  {
    id: "takeaway",
    patterns: [/take.?away|mitnehmen|to go|abholen|online bestell/i],
    answer:
      "Ja, alle Gerichte gibt es auch zum Mitnehmen (ökologisch verpackt). Online-Bestellung zu bestimmten Zeiten, telefonische Bestellungen während der Öffnungszeiten. Soll ich dich verbinden?"
  },
  {
    id: "wifi",
    patterns: [/wifi|wlan|internet/i],
    answer:
      "Ja, es gibt kostenloses WLAN."
  },

  // Kitchen Opening Hours – inkl. Sonntag Mittag
  {
    id: "hours",
    patterns: [/öffnungszeit|wann.*offen|wann.*geöffnet|lunch|mittag|abend|dinner|küchenzeit/i],
    answer: (text) => {
      const isSundayLunch = /sonntag.*(mittag|lunch|12|13|14)/i.test(text);
      if (isSundayLunch) {
        return "Sonntag Mittag geöffnet: 12:00–14:00 (letzte Küchenbestellung 13:50).";
      }
      return [
        "Küchenzeiten:",
        "Dienstag: geschlossen",
        "Mi–Mo: 17:30–21:30 (letzte Küchenbestellung 21:15)",
        "Sonntag (Mittag): 12:00–14:00 (letzte Küchenbestellung 13:50)"
      ].join("\n");
    }
  }
];

function matchFAQ(userText) {
  if (!userText) return null;
  for (const item of FAQ) {
    const hit = item.patterns.some(rx => rx.test(userText));
    if (hit) {
      return typeof item.answer === "function" ? item.answer(userText) : item.answer;
    }
  }
  return null;
}

// =============================
// (Optional) Retrieval – deaktiviert
// =============================
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

// =============================
// Verlauf kürzen
// =============================
function sanitizeHistory(history = []) {
  return history
    .filter(h => h && h.role && h.content)
    .map(h => ({
      role: h.role,
      content: String(h.content).slice(0, 1200)
    }))
    .slice(-MAX_TURNS * 2);
}

// =============================
// LLM mit Fallback
// =============================
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
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });
    return resp.choices[0].message.content;
  }

  const primary = "gpt-5-mini";
  const fallback = "gpt-4o-mini";

  try {
    return await callModel(primary);
  } catch (e1) {
    const msg1 = e1?.response?.data?.error?.message || e1?.message || String(e1);
    console.warn(`LLM PRIMARY (${primary}) failed:`, msg1);

    const shouldFallback =
      /model|unsupported|unknown|not\s+found|unavailable/i.test(msg1);
    if (!shouldFallback) throw new Error(msg1);

    try {
      return await callModel(fallback);
    } catch (e2) {
      const msg2 = e2?.response?.data?.error?.message || e2?.message || String(e2);
      throw new Error(`Fallback (${fallback}) failed: ${msg2}`);
    }
  }
}

// =============================
// Mail-Transport
// =============================
const transporter = makeTransporter({
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
});

// =============================
// Chat Endpoint
// =============================
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message fehlt" });
    }

    const threadId = crypto.randomBytes(4).toString("hex");
    const cleanHistory = sanitizeHistory(history);

    // 0) FAQ: Sofort-Antwort ohne LLM
    const faq = matchFAQ(message);
    if (faq) {
      (async () => {
        try {
          const subject = `[Sukhothai Bot] FAQ #${threadId}`;
          const lines = [
            ...cleanHistory,
            { role: "user", content: message },
            { role: "assistant", content: faq },
          ].map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
          await sendTranscript(transporter, {
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject,
            text: lines
          });
        } catch (err) {
          console.error("Mailfehler FAQ:", err?.message);
        }
      })();
      return res.json({ ok: true, answer: faq, threadId });
    }

    // 1) (optional) Retrieval – deaktiviert
    let context = "";
    if (ENABLE_RETRIEVAL) {
      try {
        // context = await retrieveContext(message, 3);
        context = "";
      } catch (e) {
        console.warn("Kontextsuche fehlgeschlagen (ohne Kontext weiter):", e?.message);
      }
    }

    // 2) LLM
    const answer = await llmAnswer({ userMsg: message, history: cleanHistory, context });

    // Mail (best effort, async)
    (async () => {
      try {
        const subject = `[Sukhothai Bot] Chat #${threadId}`;
        const lines = [
          ...cleanHistory,
          { role: "user", content: message },
          { role: "assistant", content: answer },
        ].map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
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

// =============================
// Reservierungs-Endpoint
// =============================
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

// =============================
// Health/Status
// =============================
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    hasKey: !!process.env.OPENAI_API_KEY,
    origins: ORIGINS,
    fastMode: !ENABLE_RETRIEVAL,
    version: "status-" + new Date().toISOString(),
  });
});

app.get("/status", async (_req, res) => {
  try {
    const chat = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Sag nur deinen Modellnamen." }],
      max_completion_tokens: 16
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

// =============================
// Root
// =============================
app.get("/", (_req, res) => {
  res.type("text/plain").send("Sukhothai Assist: OK");
});

app.listen(PORT, () => {
  console.log(`Sukhothai Assist läuft auf :${PORT}`);
});
