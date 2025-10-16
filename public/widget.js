(() => {
  // ---- Einstellungen ----
  const API = window.SUKH_TALK_API || "/chat"; // Server-Endpunkt

  // ---- Styles ----
  const css = `
  #sb-wrap{
    position:fixed; left:18px; top:50%;
    transform:translateY(-50%);
    z-index:2147483647;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif !important;
  }
  #sb-open{
    border:none !important; border-radius:9999px !important;
    width:56px !important; height:56px !important;
    background:#000 !important; color:#fff !important;
    box-shadow:0 6px 24px rgba(0,0,0,.2) !important;
    cursor:pointer !important; font-weight:700 !important;
  }
  #sb-panel{
    display:none !important;               /* Start: VERSTECKT */
    width:min(360px, calc(100vw - 32px)) !important;
    height:min(560px, calc(100vh - 120px)) !important;
    margin-top:12px !important;
    background:#fff !important; color:#111 !important;
    border-radius:16px !important;
    box-shadow:0 16px 48px rgba(0,0,0,.28) !important;
    overflow:hidden !important;
    /* WICHTIG: hier KEIN display:flex !important setzen */
  }
  #sb-panel.sb-flex{                       /* sichtbar als Flex-Container */
    display:flex !important; flex-direction:column !important; box-sizing:border-box !important;
  }
  #sb-head{
    background:#000 !important; color:#fff !important;
    padding:12px 14px !important; font-weight:700 !important;
    display:flex !important; align-items:center !important; justify-content:space-between !important;
  }
  #sb-close{
    background:transparent !important; border:none !important;
    color:#fff !important; font-size:20px !important; line-height:1 !important;
    cursor:pointer !important; padding:0 6px !important;
  }
  #sb-log{
    flex:1 1 auto !important; overflow:auto !important; padding:12px !important;
    background:#fff !important; color:#111 !important;
    font-size:14px !important; line-height:1.45 !important;
  }
  #sb-log .msg{ margin:8px 0 !important; }
  #sb-log .who{ font-weight:700 !important; margin-bottom:2px !important; }
  #sb-log .text{ white-space:pre-wrap !important; }
  #sb-inp{
    display:flex !important; gap:8px !important; border-top:1px solid #eee !important;
    padding:10px !important; background:#fff !important; box-sizing:border-box !important;
  }
  #sb-input{
    flex:1 1 auto !important; min-width:0 !important;
    border:1px solid #ddd !important; border-radius:10px !important;
    padding:10px 12px !important; outline:none !important;
    background:#fff !important; color:#111 !important;
  }
  #sb-input::placeholder{ color:#777 !important; }
  #sb-send{
    flex:0 0 auto !important; border:none !important; border-radius:10px !important;
    padding:10px 16px !important; background:#000 !important; color:#fff !important;
    font-weight:600 !important; cursor:pointer !important;
  }
  #sb-send[disabled]{ opacity:.6 !important; cursor:default !important; }

  /* Click-Outside Overlay */
  #sb-overlay{
    position:fixed; inset:0; background:transparent; z-index:2147483646; display:none;
  }
  #sb-overlay.show{ display:block; }
  @media (max-width:480px){
    #sb-panel{ width:calc(100vw - 32px) !important; height:min(70vh, calc(100vh - 140px)) !important; }
  }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---- Markup ----
  const wrap = document.createElement("div");
  wrap.id = "sb-wrap";
  wrap.innerHTML = `
    <button id="sb-open" aria-expanded="false" aria-controls="sb-panel" title="Chat öffnen">Chat</button>
    <div id="sb-panel" role="dialog" aria-label="Sukhothai Assist">
      <div id="sb-head">
        <span>Sukhothai Assist</span>
        <button id="sb-close" aria-label="Schließen" title="Schließen">×</button>
      </div>
      <div id="sb-log"></div>
      <div id="sb-inp">
        <input id="sb-input" type="text" placeholder="Frage stellen…" />
        <button id="sb-send">Senden</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // Click-Outside Overlay
  const overlay = document.createElement("div");
  overlay.id = "sb-overlay";
  document.body.appendChild(overlay);

  // ---- Logic ----
  const openBtn = wrap.querySelector("#sb-open");
  const closeBtn = wrap.querySelector("#sb-close");
  const panel   = wrap.querySelector("#sb-panel");
  const log     = wrap.querySelector("#sb-log");
  const input   = wrap.querySelector("#sb-input");
  const send    = wrap.querySelector("#sb-send");
  const history = [];

  function add(role, text){
    const row = document.createElement("div");
    row.className = "msg";
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = role === "user" ? "Du" : "Sukhothai";
    const body = document.createElement("div");
    body.className = "text";
    body.textContent = String(text || "");
    row.appendChild(who); row.appendChild(body);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function openPanel() {
    if (!panel.classList.contains("sb-flex")) {
      panel.classList.add("sb-flex");                  // sichtbar machen
      openBtn.setAttribute("aria-expanded","true");
      overlay.classList.add("show");
      setTimeout(() => { try{ input.focus(); }catch{} }, 10);
    }
  }
  function closePanel() {
    if (panel.classList.contains("sb-flex")) {
      panel.classList.remove("sb-flex");               // wieder verstecken
      openBtn.setAttribute("aria-expanded","false");
      overlay.classList.remove("show");
    }
  }

  const openOnce = (ev) => { ev.preventDefault && ev.preventDefault(); openPanel(); };
  openBtn.addEventListener("click", openOnce, { passive:false });
  openBtn.addEventListener("touchend", openOnce, { passive:false });
  openBtn.addEventListener("pointerup", openOnce, { passive:false });
  closeBtn.addEventListener("click", closePanel);
  overlay.addEventListener("click", closePanel);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });

  async function sendMsg(){
    const msg = (input.value || "").trim();
    if (!msg || send.disabled) return;
    add("user", msg);
    input.value = "";
    send.disabled = true;

    try{
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ message: msg, history })
      });

      if (!res.ok) {
        add("assistant", `Server-Fehler (${res.status})`);
      } else {
        const data = await res.json();
        add("assistant", data.answer || data.error || "Entschuldige, es gab ein Problem.");
        history.push({ role:"user", content: msg });
        history.push({ role:"assistant", content: data.answer || data.error || "" });
      }
    } catch (e) {
      add("assistant", "Netzwerkfehler oder API nicht erreichbar.");
      console.error("Chat Fehler:", e);
    } finally {
      send.disabled = false;
    }
  }
  send.addEventListener("click", sendMsg);
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendMsg(); });
})();
