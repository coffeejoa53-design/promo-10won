/* 채널 등록부 (UTM 빌더의 카드 목록). 관리자만.
   GET → 목록 · POST → 추가 · PATCH → 수정(이름·메모·숨기기) */
const db = require("../../lib/db");
const utm = require("../../lib/utm");
const auth = require("../../lib/auth");

const MODES = ["none", "serial", "date", "free"];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!auth.requireAdmin(req, res)) return;
  if (!db.hasEnv()) { res.status(503).json({ ok: false, error: "no_db" }); return; }

  try {
    if (req.method === "GET") {
      const rows = await db.restAll(db.TABLES.channels + "?select=*&order=sort.asc,created_at.asc");
      res.status(200).json({ ok: true, channels: rows });
      return;
    }

    if (req.method === "POST") {
      const b = auth.readBody(req);
      const code = utm.normalizeValue(b.code);
      const source = utm.normalizeValue(b.source);
      const medium = utm.normalizeValue(b.medium);
      const name = String(b.name || "").trim().slice(0, 40);
      if (!code || !source || !medium || !name) { res.status(400).json({ ok: false, error: "required", message: "코드·이름·source·medium 은 필수입니다." }); return; }
      if (utm.hasHangul(b.code) || utm.hasHangul(b.source) || utm.hasHangul(b.medium)) { res.status(400).json({ ok: false, error: "hangul", message: "코드·source·medium 에는 한글을 쓸 수 없습니다." }); return; }
      const row = {
        code: code,
        name: name,
        source: source,
        medium: medium,
        content_mode: MODES.indexOf(b.content_mode) >= 0 ? b.content_mode : "free",
        content_prefix: utm.normalizeValue(b.content_prefix) || null,
        note: String(b.note || "").trim().slice(0, 200) || null,
        sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 100,
        active: true
      };
      const created = await db.rest(db.TABLES.channels, { method: "POST", body: row });
      res.status(200).json({ ok: true, channel: created && created[0] });
      return;
    }

    if (req.method === "PATCH") {
      const b = auth.readBody(req);
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ ok: false, error: "id" }); return; }
      const patch = {};
      if (typeof b.active === "boolean") patch.active = b.active;
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 40);
      if (typeof b.note === "string") patch.note = b.note.trim().slice(0, 200) || null;
      if (Number.isFinite(Number(b.sort))) patch.sort = Number(b.sort);
      if (MODES.indexOf(b.content_mode) >= 0) patch.content_mode = b.content_mode;
      if (typeof b.content_prefix === "string") patch.content_prefix = utm.normalizeValue(b.content_prefix) || null;
      if (!Object.keys(patch).length) { res.status(400).json({ ok: false, error: "empty" }); return; }
      const updated = await db.rest(db.TABLES.channels + "?id=eq." + id, { method: "PATCH", body: patch });
      res.status(200).json({ ok: true, channel: updated && updated[0] });
      return;
    }

    res.status(405).json({ ok: false, error: "method" });
  } catch (e) {
    console.error("[channels]", e && e.message);
    res.status(500).json({ ok: false, error: "server", message: String(e && e.message).slice(0, 200) });
  }
};
