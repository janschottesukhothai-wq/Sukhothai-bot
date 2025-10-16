(() => {
  // -------- Settings --------
  const API = window.SUKH_TALK_API || "/chat"; // Chat-Endpoint

  // -------- Styles --------
  const css = `
  #sb-wrap{
    position:fixed;
    left:18px;
    top:50%;
    transform:translateY(-50%);
    z-index:2147483647;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  }
  #sb-open{
    border:none;
    border-radius:9999px;
    width:56px;height:56px;
    background:#000;color:#fff;
    box-shadow:0 6px 24px rgba(0,0,0,.2);
    cursor:pointer;font-weight:700;
  }
  #sb-panel{
    display:none; /* wird mit erstem Klick geöffnet */
    width:min(360px, calc(100vw - 32px));
    height:min(560px, calc(100vh - 120px));
    margin-top:12px;
    background:#fff;border-radius:16px;
    box-shadow:0 16px 48px rgba(0,0,0,.28);
    overflow:hidden;display:flex;flex-direction:column;
    box-sizing:border-box;
  }
  #sb-head{
    background:#000;color:#fff;
    padding:12px 14px;font-weight:700;
  }
  #sb-log{
    flex:1;overflow:auto;padding:12px;
    font-size:14px;line-height:1.45;background:#fff;
  }
  #sb-log .msg{margin:8px 0;}
  #sb-log .who{font-weight:700;margin-bottom:2px;}
  #sb-log .text{white-space:pre-wrap;}
  #sb-inp{
    display:flex;gap:8px;border-top:1px solid #eee;
    padding:10px;background:#fff;box-sizing:border-box;
  }
  #sb-input{
    flex:1 1 auto;min-width:0;
    border:1px solid #ddd;border-radius:10px;
    padding:10px 12px;outline:none;
  }
  #sb-send{
    flex:0 0 auto;border:none;border-radius:10px;
    padding:10px 16px;background:#000;color:#fff;
    font-weight:600;cursor:pointer;
  }
  #sb-send[disabled]{opacity:.6;cursor:default;}

  @media (max-width:480px){
    #sb-panel{
      width:calc(100vw - 32px);
      height:min(70vh, calc(100vh - 140px));
    }
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // -------- Markup --------
  const wrap = document.createElement("div");
  wrap.id = "sb-wrap";
  wrap.innerHTML = `
    <button id="sb-open" aria-expanded="false" aria-controls="sb-panel" title="Chat öffnen">Chat</button>
    <div id="sb-panel" role="dialog" aria-label="Sukhothai Assist">
      <div id="sb-head">Sukhothai Assist</div>
      <div id="sb-log"></div>
      <div id="sb-inp">
        <input id="sb-input" type="text" placeholder="Frage stellen…" />
        <button id="sb-send">Senden</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // -------- Logic --------
  const openBtn = wrap.querySelector("#sb-open");
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

  function openPanel(){
    if (panel.style.display !== "block") {
      panel.style.display = "block";
      openBtn.setAttribute("aria-expanded","true");
      // Sofort fokussieren → ein Klick reicht auch auf iOS
      setTimeout(() => input.focus(), 10);
    }
  }
  function togglePanel(){
    if (panel.style.display === "block") {
      panel.style.display = "none";
      openBtn.setAttribute("aria-expanded","false");
    } else {
      openPanel();
    }
  }

  // Ein-Klick-Öffnen: click/touch/pointer
  const openOnce = (ev) => { ev.preventDefault(); openPanel(); };
  openBtn.addEventListener("click", openOnce, { passive:false });
  openBtn.addEventListener("touchend", openOnce, { passive:false });
  openBtn.addEventListener("pointerup", openOnce, { passive:false });

  // Optional: Panel schließen beim Klick auf Header (kannst du entfernen)
  wrap.querySelector("#sb-head").addEventListener("click", togglePanel);

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

  // Optional: ESC schließt
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && panel.style.display === "block") {
      panel.style.display = "none";
      openBtn.setAttribute("aria-expanded","false");
    }
  });
})();
