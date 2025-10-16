import "dotenv/config";
import fs from "fs";
import fetch from "node-fetch";
import { marked } from "marked";
import { OpenAI } from "openai";
import { loadStore, saveStore } from "./vectorStore.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function chunk(text, size=1200, overlap=150) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i+size));
    i += size - overlap;
  }
  return out;
}

async function embed(text) {
  const r = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });
  return r.data[0].embedding;
}

async function ingestURL(url) {
  const res = await fetch(url);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chunks = chunk(text);
  const items = [];
  for (const c of chunks) {
    const vec = await embed(c);
    items.push({ text: c, embedding: vec, meta: { source: url } });
  }
  return items;
}

async function ingestFile(path) {
  const raw = fs.readFileSync(path, "utf-8");
  const text = path.endsWith(".md") ? marked.parse(raw).replace(/<[^>]+>/g, " ") : raw;
  const chunks = chunk(text);
  const items = [];
  for (const c of chunks) {
    const vec = await embed(c);
    items.push({ text: c, embedding: vec, meta: { source: path } });
  }
  return items;
}

async function main() {
  let store = loadStore();
  console.log("Vorhandene Einträge:", store.items?.length || 0);
  store.items = store.items || [];

  // Seed aus Datei
  if (fs.existsSync("data/seed_faqs.md")) {
    const items = await ingestFile("data/seed_faqs.md");
    store.items.push(...items);
  }

  // URLs aus ENV
  const urls = (process.env.SEED_URLS || "").split(",").map(s => s.trim()).filter(Boolean);
  for (const url of urls) {
    try {
      console.log("Crawle:", url);
      const items = await ingestURL(url);
      store.items.push(...items);
    } catch (e) {
      console.warn("Fehler beim Crawlen:", url, e.message);
    }
  }

  saveStore(store);
  console.log("Gespeichert:", store.items.length, "Chunks in data/embeddings.json");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
