/* 랜딩 행동 기록: view(랜딩 도달) · cta(스토어 쿠폰 받기 버튼 클릭).
   개인정보는 받지 않는다. sid 는 브라우저 세션마다 만든 임의 문자열이라 사람을 식별하지 않는다. */
const db = require("../lib/db");
const utm = require("../lib/utm");
const { readBody } = require("../lib/auth");

function deviceOf(ua) {
  if (!ua) return "other";
  if (/mobile|iphone|ipod|android.+mobile|windows phone/i.test(ua)) return "mobile";
  if (/ipad|tablet|android/i.test(ua)) return "mobile";
  if (/macintosh|windows nt|x11|linux/i.test(ua)) return "desktop";
  return "other";
}

function hostOf(ref) {
  if (!ref) return null;
  try { return new URL(ref).hostname.replace(/^www\./, "").slice(0, 200); } catch (_) { return null; }
}

function orNull(v) {
  const n = utm.normalizeValue(v);
  return n || null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method" }); return; }
  if (!db.hasEnv()) { res.status(204).end(); return; }

  const b = readBody(req);
  const event = b.event === "cta" ? "cta" : b.event === "view" ? "view" : null;
  if (!event) { res.status(400).json({ ok: false, error: "event" }); return; }

  const sid = String(b.sid || "").replace(/[^a-z0-9]/gi, "").slice(0, 32) || null;
  const row = {
    event: event,
    sid: sid,
    utm_source: orNull(b.utm_source),
    utm_medium: orNull(b.utm_medium),
    utm_campaign: orNull(b.utm_campaign),
    utm_content: orNull(b.utm_content),
    utm_term: orNull(b.utm_term),
    referrer_host: hostOf(b.ref),
    landing_path: String(b.path || "/").slice(0, 100),
    device: deviceOf(req.headers["user-agent"] || "")
  };

  try {
    await db.rest(db.TABLES.events, { method: "POST", body: row, prefer: "return=minimal" });
  } catch (e) {
    console.error("[track]", e && e.message);
  }
  res.status(204).end();
};
