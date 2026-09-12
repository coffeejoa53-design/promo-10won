/* UTM 링크 장부. 관리자만.
   GET   → 목록 (?all=1 이면 보관한 것도)
   POST  → 생성. { channelIds: [...], campaign, content, term, label } 또는 { manual: { source, medium, campaign, content, term, label } }
           같은 조합이 이미 있으면 새 행을 만들지 않고 기존 행을 돌려준다.
   PATCH → { id, archived?, label? } */
const db = require("../../lib/db");
const utm = require("../../lib/utm");
const auth = require("../../lib/auth");

const SELECT = "select=*,channel:" + db.TABLES.channels + "(id,code,name)";

function eqOrNull(field, v) {
  return v ? "&" + field + "=eq." + encodeURIComponent(v) : "&" + field + "=is.null";
}

async function findSame(p) {
  const q = db.TABLES.links + "?" + SELECT +
    "&source=eq." + encodeURIComponent(p.source) +
    "&medium=eq." + encodeURIComponent(p.medium) +
    "&campaign=eq." + encodeURIComponent(p.campaign) +
    eqOrNull("content", p.content) + eqOrNull("term", p.term) + "&limit=1";
  const rows = await db.rest(q);
  return rows && rows[0] ? rows[0] : null;
}

async function codeTaken(code) {
  const rows = await db.rest(db.TABLES.links + "?select=id&short_code=eq." + encodeURIComponent(code) + "&limit=1");
  return Boolean(rows && rows[0]);
}

async function createOne(p, channel) {
  const existing = await findSame(p);
  if (existing) return { link: existing, existed: true };

  const url = utm.buildUtmUrl(utm.LANDING_URL, p);
  const baseCode = channel
    ? utm.suggestShortCode(channel.code, p.content)
    : utm.normalizeValue(p.source + "-" + p.medium + (p.content ? "-" + p.content : ""));
  let code = baseCode || "link";
  if (await codeTaken(code)) code = (baseCode + "-" + utm.randomSuffix()).slice(0, 40);

  const row = {
    channel_id: channel ? channel.id : null,
    landing_path: "/",
    source: p.source,
    medium: p.medium,
    campaign: p.campaign,
    content: p.content || null,
    term: p.term || null,
    url: url,
    short_code: code,
    label: p.label || null,
    created_by: "admin"
  };
  let created;
  try {
    created = await db.rest(db.TABLES.links + "?" + SELECT, { method: "POST", body: row });
  } catch (e) {
    if (e.status === 409) {
      // 짧은 코드 충돌이면 꼬리를 붙여 한 번 더, 조합 충돌이면 기존 행을 돌려준다
      const again = await findSame(p);
      if (again) return { link: again, existed: true };
      row.short_code = (baseCode + "-" + utm.randomSuffix()).slice(0, 40);
      created = await db.rest(db.TABLES.links + "?" + SELECT, { method: "POST", body: row });
    } else {
      throw e;
    }
  }
  return { link: created && created[0], existed: false };
}

function cleanParts(src) {
  const p = {
    source: utm.normalizeValue(src.source),
    medium: utm.normalizeValue(src.medium),
    campaign: utm.normalizeValue(src.campaign) || utm.DEFAULT_CAMPAIGN,
    content: utm.normalizeValue(src.content) || null,
    term: utm.normalizeValue(src.term) || null,
    label: String(src.label || "").trim().slice(0, 120) || null
  };
  if (utm.hasHangul(src.source) || utm.hasHangul(src.medium) || utm.hasHangul(src.campaign) || utm.hasHangul(src.content) || utm.hasHangul(src.term)) {
    return { error: "UTM 값에는 한글을 쓸 수 없습니다. 영문·숫자·하이픈만 됩니다." };
  }
  if (!p.source || !p.medium) return { error: "source 와 medium 은 필수입니다." };
  return p;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!auth.requireAdmin(req, res)) return;
  if (!db.hasEnv()) { res.status(503).json({ ok: false, error: "no_db" }); return; }

  try {
    if (req.method === "GET") {
      const all = req.query && (req.query.all === "1" || req.query.all === "true");
      const rows = await db.restAll(db.TABLES.links + "?" + SELECT + (all ? "" : "&archived=eq.false") + "&order=created_at.desc");
      res.status(200).json({ ok: true, links: rows });
      return;
    }

    if (req.method === "POST") {
      const b = auth.readBody(req);
      const results = [];

      if (b.manual && typeof b.manual === "object") {
        const p = cleanParts(b.manual);
        if (p.error) { res.status(400).json({ ok: false, error: "invalid", message: p.error }); return; }
        results.push(await createOne(p, null));
      } else {
        const ids = Array.isArray(b.channelIds) ? b.channelIds.filter(function (x) { return /^[0-9a-f-]{36}$/i.test(String(x)); }) : [];
        if (!ids.length) { res.status(400).json({ ok: false, error: "channels", message: "채널을 하나 이상 고르세요." }); return; }
        const channels = await db.rest(db.TABLES.channels + "?select=*&id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
        if (!channels || !channels.length) { res.status(400).json({ ok: false, error: "channels" }); return; }
        for (const ch of channels) {
          const p = cleanParts({ source: ch.source, medium: ch.medium, campaign: b.campaign, content: b.content, term: b.term, label: b.label });
          if (p.error) { res.status(400).json({ ok: false, error: "invalid", message: p.error }); return; }
          results.push(await createOne(p, ch));
        }
      }
      res.status(200).json({ ok: true, results: results });
      return;
    }

    if (req.method === "PATCH") {
      const b = auth.readBody(req);
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ ok: false, error: "id" }); return; }
      const patch = {};
      if (typeof b.archived === "boolean") patch.archived = b.archived;
      if (typeof b.label === "string") patch.label = b.label.trim().slice(0, 120) || null;
      if (!Object.keys(patch).length) { res.status(400).json({ ok: false, error: "empty" }); return; }
      const updated = await db.rest(db.TABLES.links + "?id=eq." + id + "&" + SELECT, { method: "PATCH", body: patch });
      res.status(200).json({ ok: true, link: updated && updated[0] });
      return;
    }

    res.status(405).json({ ok: false, error: "method" });
  } catch (e) {
    console.error("[links]", e && e.message);
    res.status(500).json({ ok: false, error: "server", message: String(e && e.message).slice(0, 200) });
  }
};
