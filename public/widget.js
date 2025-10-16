(() => {
  const style = document.createElement("style");
  style.textContent = `
#sb-wrap{position:fixed;right:18px;bottom:18px;z-index:999999}
#sb-panel{display:none;width:320px;height:480px;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.2);overflow:hidden}
#sb-head{background:#000;color:#fff;padding:10px 14px;font-weight:600}
#sb-log{height:380px;overflow:auto;padding:10px;font:14px/1.4 system-ui}
#sb-open{border:none;border-radius:9999px;padding:14px 18px;box-shadow:0 4px 20px rgba(0,0,0,.15);cursor:pointer}
#sb-inp{display:flex;border-top:1px solid #eee}
#sb-inp input{flex:1;border:none;padding:10px 12px;outline:none}
#sb-inp button{border:none;padding:10px 12px;cursor:pointer}
`;
  document.head.appendChild(style);
  const wrap = document.createElement("div");
  wrap.id = "sb-wrap";
  wrap.innerHTML = `
    <button id="sb-open">Chat</button>
    <div id="sb-panel">
      <div id="sb-head">Sukhothai Assist</div>
      <div id="sb-log"></div>
      <div id="sb-inp">
        <input id="sb-input" placeholder="Frage stellen…"/>
        <button id="sb-send">Senden</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const openBtn = wrap.querySelector("#sb-open");
  const panel = wrap.querySelector("#sb-panel");
  const log = wrap.querySelector("#sb-log");
  const input = wrap.querySelector("#sb-input");
  const send = wrap.querySelector("#sb-send");
  const API = window.SUKH_TALK_API || "/chat";
  const history = [];

  function add(role, text) {
    const el = document.createElement("div");
    el.style.margin = "8px 0";
    el.innerHTML = `<div style="font-weight:600">${role==="user"?"Du":"Sukhothai"}</div><div>${(text||"").replace(/\n/g,"<br>")}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  openBtn.onclick = () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  };

  async function sendMsg() {
    const msg = (input.value || "").trim();
    if (!msg) return;
    add("user", msg);
    input.value = "";
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ message: msg, history })
      });
      const data = await res.json();
      add("assistant", data.answer || "Entschuldige, Fehler.");
      history.push({ role: "user", content: msg }, { role: "assistant", content: data.answer || "" });
    } catch (e) {
      add("assistant", "Netzwerkfehler.");
    }
  }

  send.onclick = sendMsg;
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendMsg(); });
})();
