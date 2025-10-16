(() => {
  // ==== Konfiguration aus window ====
  const API = window.SUKH_TALK_API || "/chat";
  const BOTTOM_OFFSET = Number(window.SUKH_TALK_BOTTOM_OFFSET || 0); // px

  // ==== Styles ====
  const style = document.createElement("style");
  style.textContent = `
:root{
  --sb-safe-bottom: env(safe-area-inset-bottom, 0px);
  --sb-bottom-offset: ${BOTTOM_OFFSET}px;
}
#sb-wrap{ position: fixed; inset: 0 auto auto 16px; z-index: 2147483000; pointer-events:none; }

/* Bubble */
#sb-bubble{
  pointer-events:auto; position: fixed; left:16px;
  bottom: calc(16px + var(--sb-safe-bottom) + var(--sb-bottom-offset));
  width:54px; height:54px; border-radius:9999px; background:#000; color:#fff;
  display:flex; align-items:center; justify-content:center;
  font:600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.22); cursor:pointer;
}
@media (min-width: 641px){
  #sb-bubble{ top:50%; bottom:auto; transform:translateY(-50%); }
}

/* Panel */
#sb-panel{
  pointer-events:auto; position: fixed; display:none; /* wichtig */
  left:16px;
  bottom: calc(16px + var(--sb-safe-bottom) + var(--sb-bottom-offset));
  width: min(420px, 92vw); max-width:420px;
  background:#fff; border-radius:16px; box-shadow:0 18px 48px rgba(0,0,0,.28);
  overflow:hidden; box-sizing:border-box; display:flex; flex-direction:column;
  max-height:min(80vh, 680px);
}
@media (min-width: 641px){
  #sb-panel{ top:50%; transform:translateY(-50%); bottom:auto; }
}

/* Header */
#sb-head{
  height:48px; min-height:48px; background:#000; color:#fff;
  display:flex; align-items:center; justify-content:space-between;
  padding:0 14px; font:600 16px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
#sb-close{ appearance:none; border:0; background:transparent; color:#fff; font-size:20px; cursor:pointer; line-height:1; }

/* Body */
#sb-body{ flex:1; min-height:0; display:flex; flex-direction:column; }
#sb-log{ flex:1; min-height:0; overflow:auto; padding:12px 12px 6px; font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111; }
.sb-msg{ margin:8px 0; }
.sb-msg .sb-role{ font-weight:600; margin-bottom:2px; }

/* Input */
#sb-inp{ display:flex; gap:8px; padding:10px 12px calc(10px + var(--sb-safe-bottom)); border-top:1px solid #eee; background:#fff; }
#sb-input{ flex:1; padding:10px 12px; border:1px solid #ddd; border-radius:10px; outline:none; font:14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
#sb-send{ border:none; border-radius:10px; padding:0 14px; min-width:96px; height:40px; background:#000; color:#fff; cursor:pointer; font:600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }

/* Animation */
.sb-open{ animation: sbFade .14s ease-out; }
@keyframes sbFade{ from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:translateY(0);} }

/* Wenn offen: Bubble verstecken, damit kein "Durchklick" passieren kann */
.sb-is-open #sb-bubble{ display:none !important; }
`;
  document.head.appendChild(style);

  // ==== Markup ====
  const wrap = document.createElement("div");
  wrap.id = "sb-wrap";
  wrap.innerHTML = `
    <button id="sb-bubble" aria-label="Chat öffnen">Chat</button>
    <div id="sb-panel" role="dialog" aria-modal="true" aria-label="Sukhothai Assist" style="display:none">
      <div id="sb-head">
        <div>Sukhothai Assist</div>
        <button id="sb-close" aria-label="Chat schließen">×</button>
      </div>
      <div id="sb-body">
        <div id="sb-log" aria-live="polite" aria-atomic="false"></div>
        <div id="sb-inp">
          <input id="sb-input" placeholder="Frage stellen…" autocomplete="off" />
          <button id="sb-send">Senden</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // ==== Refs ====
  const bubble = wrap.querySelector("#sb-bubble");
  const panel  = wrap.querySelector("#sb-panel");
  const close  = wrap.querySelector("#sb-close");
  const log    = wrap.querySelector("#sb-log");
  const input  = wrap.querySelector("#sb-input");
  const send   = wrap.querySelector("#sb-send");

  const history = [];
  let isOpen = false;

  // ==== Helpers ====
  function add(role, text){
    const el = document.createElement("div");
    el.className = "sb-msg";
    el.innerHTML = `<div class="sb-role">${role==="user"?"Du":"Sukhothai"}</div><div class="sb-text">${(text||"").replace(/\n/g,"<br>")}</div>`;
    log.appendChild(el);
    setTimeout(()=>{ log.scrollTop = log.scrollHeight; }, 0);
  }

  function openPanel(ev){
    if (ev) ev.stopPropagation();
    if (isOpen) return;
    isOpen = true;
    document.documentElement.classList.add("sb-is-open");
    panel.style.display = "flex";
    panel.classList.add("sb-open");
    setTimeout(()=> input.focus(), 30);
  }

  function closePanel(ev){
    if (ev){
      ev.stopPropagation();
      ev.preventDefault();
    }
    if (!isOpen) return;
    isOpen = false;
    panel.style.display = "none";
    document.documentElement.classList.remove("sb-is-open");
  }

  // ==== Events ====
  bubble.addEventListener("click", openPanel, { passive: true });
  close.addEventListener("click", closePanel);

  // Klick im Panel soll nicht die Bubble dahinter auslösen
  panel.addEventListener("click", e => e.stopPropagation());
  // Optional: Klick außerhalb schließt
  document.addEventListener("click", e => {
    if (!isOpen) return;
    // Wenn Klick NICHT im Panel war, schließen
    if (!panel.contains(e.target) && e.target !== bubble) {
      closePanel(e);
    }
  });

  async function sendMsg(){
    const msg = (input.value||"").trim();
    if (!msg) return;
    add("user", msg);
    input.value = "";
    try{
      const res = await fetch(API, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ message: msg, history })
      });
      if (!res.ok){
        add("assistant", `Server-Fehler (${res.status})`);
        return;
      }
      const data = await res.json();
      add("assistant", data.answer || data.error || "Entschuldige, es gab ein Problem.");
      history.push(
        { role:"user", content: msg },
        { role:"assistant", content: data.answer || data.error || "" }
      );
    } catch(e){
      add("assistant", "Netzwerkfehler oder API nicht erreichbar.");
      console.error("Chat Fehler:", e);
    }
  }

  send.addEventListener("click", sendMsg);
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendMsg(); });

  // zur Sicherheit: niemals auto-open
  // (manche Caches lieferten alte Version; hier hart sicherstellen)
  panel.style.display = "none";
  document.documentElement.classList.remove("sb-is-open");
})();
