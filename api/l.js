/* 짧은 링크: /l/<code> → 클릭 1 세고 UTM 긴 주소로 302.
   vercel.json 의 rewrite 가 /l/:code 를 /api/l?code=:code 로 보낸다. */
const db = require("../lib/db");
const utm = require("../lib/utm");

/* 링크 미리보기 봇은 클릭으로 세지 않는다 */
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|kakaotalk-scrap|kakaostory|twitterbot|slackbot|discordbot|telegrambot|whatsapp|linkedinbot|pinterest|skypeuripreview|embedly|quora link preview|line-poker|yeti|daum|preview|curl\/|wget\//i;

function deviceOf(ua) {
  if (!ua) return "other";
  if (/mobile|iphone|ipod|android.+mobile|windows phone/i.test(ua)) return "mobile";
  if (/ipad|tablet|android/i.test(ua)) return "mobile";
  if (/macintosh|windows nt|x11|linux/i.test(ua)) return "desktop";
  return "other";
}

function hostOf(referer) {
  if (!referer) return null;
  try { return new URL(referer).hostname.replace(/^www\./, "").slice(0, 200); } catch (_) { return null; }
}

module.exports = async (req, res) => {
  const raw = (req.query && req.query.code) || "";
  const code = utm.normalizeValue(Array.isArray(raw) ? raw[0] : raw);
  const ua = req.headers["user-agent"] || "";
  const isHead = req.method === "HEAD";
  const countIt = Boolean(code) && !isHead && !BOT_UA.test(ua);

  res.setHeader("Cache-Control", "no-store, max-age=0");

  let url = null;
  try {
    if (db.hasEnv() && code) {
      if (countIt) {
        url = await db.rpc("sambo_hit_link", {
          p_code: code,
          p_device: deviceOf(ua),
          p_referer: hostOf(req.headers.referer || req.headers.referrer)
        });
      } else {
        const rows = await db.rest(
          db.TABLES.links + "?select=url&short_code=eq." + encodeURIComponent(code) + "&archived=eq.false&limit=1"
        );
        url = rows && rows[0] ? rows[0].url : null;
      }
    }
  } catch (e) {
    console.error("[short-link]", e && e.message);
    url = null;
  }

  /* 목적지는 DB 의 url 뿐이고, 그것도 우리 랜딩 도메인일 때만 쓴다 (오픈 리다이렉트 방지).
     모르는 코드·DB 미연결이면 랜딩으로 보내되 흔적을 남긴다. */
  if (typeof url !== "string" || url.indexOf(utm.SITE_ORIGIN) !== 0) {
    url = utm.buildUtmUrl(utm.LANDING_URL, {
      source: "short-link",
      medium: "unknown",
      campaign: utm.DEFAULT_CAMPAIGN,
      content: code || "empty"
    });
  }

  res.statusCode = 302;
  res.setHeader("Location", url);
  res.end();
};
