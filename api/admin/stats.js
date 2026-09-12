/* 성과 대시보드 숫자. 관리자만. 서버가 실제로 센 값만 돌려준다.
   GET /api/admin/stats?period=today|7d|30d|all  또는  ?from=YYYY-MM-DD&to=YYYY-MM-DD (한국 시간 기준)
   클릭 = 짧은 링크를 누른 수 (sambo_link_clicks)
   도달 = 랜딩에 실제로 들어온 브라우저 세션 수 (sambo_events.view, sid 로 중복 제거)
   전환 = "스토어에서 쿠폰 받기" 버튼을 누른 세션 수 (sambo_events.cta, sid 로 중복 제거) */
const db = require("../../lib/db");
const utm = require("../../lib/utm");
const auth = require("../../lib/auth");

const KST = 9 * 60 * 60 * 1000;

function kstDate(ts) {
  return new Date(new Date(ts).getTime() + KST).toISOString().slice(0, 10);
}
function todayKst() {
  return kstDate(Date.now());
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00+09:00");
  return kstDate(d.getTime() + n * 86400000);
}
function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function rangeOf(q) {
  const today = todayKst();
  let from, to, period;
  if (isYmd(q.from) && isYmd(q.to)) { from = q.from; to = q.to; period = "custom"; }
  else {
    period = ["today", "7d", "30d", "all"].indexOf(q.period) >= 0 ? q.period : "7d";
    to = today;
    if (period === "today") from = today;
    else if (period === "7d") from = addDays(today, -6);
    else if (period === "30d") from = addDays(today, -29);
    else from = "2026-08-01";
  }
  return { period, from, to, fromIso: from + "T00:00:00+09:00", toIso: to + "T23:59:59.999+09:00" };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!auth.requireAdmin(req, res)) return;
  if (!db.hasEnv()) { res.status(503).json({ ok: false, error: "no_db" }); return; }
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "method" }); return; }

  const r = rangeOf(req.query || {});
  const tf = "&clicked_at=gte." + encodeURIComponent(r.fromIso) + "&clicked_at=lte." + encodeURIComponent(r.toIso);
  const te = "&created_at=gte." + encodeURIComponent(r.fromIso) + "&created_at=lte." + encodeURIComponent(r.toIso);

  try {
    const [links, channels, clicks, events] = await Promise.all([
      db.restAll(db.TABLES.links + "?select=id,channel_id,source,medium,campaign,content,term,short_code,label,clicks,archived,created_at&order=created_at.desc"),
      db.restAll(db.TABLES.channels + "?select=id,code,name,source,medium,sort&order=sort.asc"),
      db.restAll(db.TABLES.clicks + "?select=link_id,clicked_at,device" + tf),
      db.restAll(db.TABLES.events + "?select=event,sid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,created_at" + te)
    ]);

    const chById = {};
    channels.forEach(function (c) { chById[c.id] = c; });

    // 링크별 집계
    const byLink = {};
    const byCombo = {};
    links.forEach(function (l) {
      const row = {
        id: l.id, short_code: l.short_code, label: l.label, archived: l.archived, created_at: l.created_at,
        source: l.source, medium: l.medium, campaign: l.campaign, content: l.content, term: l.term,
        channel: l.channel_id && chById[l.channel_id] ? chById[l.channel_id].name : null,
        channel_code: l.channel_id && chById[l.channel_id] ? chById[l.channel_id].code : null,
        clicks: 0, clicks_total: l.clicks || 0, views: 0, ctas: 0,
        _v: {}, _c: {}
      };
      byLink[l.id] = row;
      byCombo[utm.comboKey(l)] = row;
    });

    const daily = {};
    function day(d) { const k = kstDate(d); if (!daily[k]) daily[k] = { date: k, clicks: 0, views: 0, ctas: 0 }; return daily[k]; }

    clicks.forEach(function (c) {
      const row = byLink[c.link_id];
      if (row) row.clicks += 1;
      day(c.clicked_at).clicks += 1;
    });

    const unmatched = {}; // 링크 장부에 없는 조합으로 들어온 사람 (직접 유입·옛 링크)
    let unmatchedSeen = { view: {}, cta: {} };
    events.forEach(function (e) {
      const key = utm.comboKey({ source: e.utm_source, medium: e.utm_medium, campaign: e.utm_campaign, content: e.utm_content, term: e.utm_term });
      const sid = e.sid || ("anon-" + Math.random());
      const row = byCombo[key];
      if (row) {
        const bag = e.event === "cta" ? row._c : row._v;
        if (!bag[sid]) { bag[sid] = 1; if (e.event === "cta") row.ctas += 1; else row.views += 1; }
      } else {
        const label = e.utm_source ? (e.utm_source + " / " + (e.utm_medium || "-")) : "직접 유입 (UTM 없음)";
        if (!unmatched[label]) unmatched[label] = { label: label, views: 0, ctas: 0 };
        const seen = unmatchedSeen[e.event === "cta" ? "cta" : "view"];
        const k2 = label + "|" + sid;
        if (!seen[k2]) { seen[k2] = 1; if (e.event === "cta") unmatched[label].ctas += 1; else unmatched[label].views += 1; }
      }
      const d = day(e.created_at);
      if (e.event === "cta") d.ctas += 1; else d.views += 1;
    });

    const linkRows = Object.keys(byLink).map(function (id) {
      const row = byLink[id];
      delete row._v; delete row._c;
      row.rate = utm.conversionRate(row.clicks, row.ctas);
      return row;
    });

    // 채널별 합계
    const byChannel = {};
    linkRows.forEach(function (row) {
      const k = row.channel || (row.source + " / " + row.medium);
      if (!byChannel[k]) byChannel[k] = { channel: k, links: 0, clicks: 0, views: 0, ctas: 0 };
      const c = byChannel[k];
      c.links += 1; c.clicks += row.clicks; c.views += row.views; c.ctas += row.ctas;
    });
    const channelRows = Object.keys(byChannel).map(function (k) {
      const c = byChannel[k]; c.rate = utm.conversionRate(c.clicks, c.ctas); return c;
    }).sort(function (a, b) { return b.ctas - a.ctas || b.clicks - a.clicks; });

    const summary = {
      clicks: clicks.length,
      views: linkRows.reduce(function (s, r) { return s + r.views; }, 0) + Object.keys(unmatched).reduce(function (s, k) { return s + unmatched[k].views; }, 0),
      ctas: linkRows.reduce(function (s, r) { return s + r.ctas; }, 0) + Object.keys(unmatched).reduce(function (s, k) { return s + unmatched[k].ctas; }, 0),
      active_links: links.filter(function (l) { return !l.archived; }).length
    };
    summary.rate = utm.conversionRate(summary.clicks, summary.ctas);

    // 일별 — 기간 안의 날은 0 이라도 넣는다 (최대 62일)
    const days = [];
    if (r.period !== "all") {
      let d = r.from;
      for (let i = 0; i < 62 && d <= r.to; i++) { days.push(day(d)); d = addDays(d, 1); }
    }
    const dailyRows = (days.length ? days : Object.keys(daily).sort().map(function (k) { return daily[k]; }));

    res.status(200).json({
      ok: true,
      range: { period: r.period, from: r.from, to: r.to },
      summary: summary,
      channels: channelRows,
      links: linkRows.sort(function (a, b) { return b.clicks - a.clicks || (a.created_at < b.created_at ? 1 : -1); }),
      unmatched: Object.keys(unmatched).map(function (k) { return unmatched[k]; }),
      daily: dailyRows
    });
  } catch (e) {
    console.error("[stats]", e && e.message);
    res.status(500).json({ ok: false, error: "server", message: String(e && e.message).slice(0, 200) });
  }
};
