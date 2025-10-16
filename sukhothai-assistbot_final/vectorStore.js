import fs from "fs";

export function cosineSim(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s,v)=>s+v*v,0));
  const nb = Math.sqrt(b.reduce((s,v)=>s+v*v,0));
  return dot / (na * nb + 1e-9);
}

export function loadStore(path="data/embeddings.json") {
  if (!fs.existsSync(path)) return { items: [] };
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

export function saveStore(store, path="data/embeddings.json") {
  fs.writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

export function topK(store, queryVec, k=6) {
  const scored = store.items.map((it) => ({
    ...it,
    score: cosineSim(queryVec, it.embedding),
  })).sort((a,b)=>b.score-a.score);
  return scored.slice(0, k);
}
