/* UTM 공용 규칙 — 서버(api/*)와 브라우저(admin/)가 같은 파일을 쓴다.
   규칙: 소문자, 띄어쓰기→하이픈, 영문·숫자·. _ - 만, 한글 금지, 한 번 정한 이름은 바꾸지 않는다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SamboUtm = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var SITE_ORIGIN = "https://promo-10won.vercel.app";
  var LANDING_URL = SITE_ORIGIN + "/";
  var DEFAULT_CAMPAIGN = "honghap-10won";

  function normalizeValue(v) {
    return String(v == null ? "" : v)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }

  function hasHangul(v) {
    return /[ㄱ-힣]/.test(String(v == null ? "" : v));
  }

  function buildUtmUrl(base, p) {
    var q = [];
    var pairs = [
      ["utm_source", normalizeValue(p.source)],
      ["utm_medium", normalizeValue(p.medium)],
      ["utm_campaign", normalizeValue(p.campaign)],
      ["utm_content", normalizeValue(p.content)],
      ["utm_term", normalizeValue(p.term)]
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1]) q.push(pairs[i][0] + "=" + encodeURIComponent(pairs[i][1]));
    }
    var clean = String(base || LANDING_URL).trim().replace(/[?#].*$/, "");
    return q.length ? clean + "?" + q.join("&") : clean;
  }

  /* 같은 조합을 장부에 한 번만 두기 위한 키. content/term 이 비면 '' */
  function comboKey(v) {
    return [v.source, v.medium, v.campaign, v.content, v.term]
      .map(function (x) { return normalizeValue(x); })
      .join("|");
  }

  function shortUrl(code, origin) {
    return (origin || SITE_ORIGIN) + "/l/" + code;
  }

  /* 채널 코드 + 소재 → 사람이 읽을 수 있는 짧은 코드. ig-post + post02 → ig-post02 */
  function suggestShortCode(channelCode, content) {
    var ch = normalizeValue(channelCode);
    var ct = normalizeValue(content);
    if (!ct) return ch;
    var parts = ch.split("-");
    var last = parts[parts.length - 1] || "";
    if (last && ct.indexOf(last) === 0 && ct.length > last.length) {
      return (ch.slice(0, ch.length - last.length) + ct).slice(0, 40);
    }
    return (ch + "-" + ct).slice(0, 40);
  }

  /* 채널 방식에 맞는 다음 소재 코드: serial → 다음 번호, date → 오늘(MMDD) */
  function suggestContent(channel, existing, today) {
    today = today || new Date();
    switch (channel.content_mode) {
      case "none": return "";
      case "date": {
        var mm = String(today.getMonth() + 1); if (mm.length < 2) mm = "0" + mm;
        var dd = String(today.getDate()); if (dd.length < 2) dd = "0" + dd;
        return mm + dd;
      }
      case "serial": {
        var prefix = normalizeValue(channel.content_prefix) || "n";
        var esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var re = new RegExp("^" + esc + "(\\d+)$");
        var max = 0;
        for (var i = 0; i < (existing || []).length; i++) {
          var l = existing[i];
          if (!l || !l.content) continue;
          var m = String(l.content).match(re);
          if (m) max = Math.max(max, Number(m[1]));
        }
        var n = String(max + 1); if (n.length < 2) n = "0" + n;
        return prefix + n;
      }
      default: return "";
    }
  }

  function randomSuffix() {
    var chars = "abcdefghjkmnpqrstuvwxyz23456789";
    var s = "";
    for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function conversionRate(clicks, conv) {
    if (!clicks) return "—";
    return Math.round((conv / clicks) * 1000) / 10 + "%";
  }

  return {
    SITE_ORIGIN: SITE_ORIGIN,
    LANDING_URL: LANDING_URL,
    DEFAULT_CAMPAIGN: DEFAULT_CAMPAIGN,
    normalizeValue: normalizeValue,
    hasHangul: hasHangul,
    buildUtmUrl: buildUtmUrl,
    comboKey: comboKey,
    shortUrl: shortUrl,
    suggestShortCode: suggestShortCode,
    suggestContent: suggestContent,
    randomSuffix: randomSuffix,
    conversionRate: conversionRate
  };
});
