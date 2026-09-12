/* 랜딩 유입 기록 — 어디서 왔는지(utm_*)를 세션에 보관하고, 도달(view)과 버튼 클릭(cta)을 서버로 보낸다.
   이름·전화 같은 개인정보는 보내지 않는다. 실패해도 페이지는 그대로 동작한다. */
(function () {
  try {
    var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var p = new URLSearchParams(location.search);
    var u = {}, has = false;
    for (var i = 0; i < KEYS.length; i++) {
      var v = p.get(KEYS[i]);
      if (v) { u[KEYS[i]] = String(v).slice(0, 60); has = true; }
    }
    // 주소에 UTM 이 있으면 그것이 항상 우선. 없으면 이 세션에서 마지막으로 본 값을 쓴다.
    if (has) sessionStorage.setItem("sambo_utm", JSON.stringify(u));
    else { try { u = JSON.parse(sessionStorage.getItem("sambo_utm") || "{}"); } catch (_) { u = {}; } }

    var sid = sessionStorage.getItem("sambo_sid");
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem("sambo_sid", sid);
    }

    function send(ev) {
      var body = JSON.stringify(Object.assign({ event: ev, sid: sid, path: location.pathname, ref: document.referrer || "" }, u));
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
          return;
        }
      } catch (_) {}
      try { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }); } catch (_) {}
    }

    if (!sessionStorage.getItem("sambo_viewed")) {
      send("view");
      sessionStorage.setItem("sambo_viewed", "1");
    }

    var ctas = document.querySelectorAll("a.cta");
    for (var j = 0; j < ctas.length; j++) {
      ctas[j].addEventListener("click", function () { send("cta"); });
    }
  } catch (_) {}
})();
