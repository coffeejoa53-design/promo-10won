/* 어드민 로그인 세션.
   GET    → 지금 로그인돼 있나 + 설정 상태 (비밀번호·DB 가 세팅됐는지만, 값은 절대 안 보냄)
   POST   → { passcode } 로 로그인, 쿠키 발급
   DELETE → 로그아웃 */
const auth = require("../../lib/auth");
const db = require("../../lib/db");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    res.status(200).json({ ok: auth.isAdmin(req), configured: auth.hasPasscode(), db: db.hasEnv() });
    return;
  }

  if (req.method === "POST") {
    if (!auth.hasPasscode()) {
      res.status(503).json({ ok: false, error: "no_passcode", message: "ADMIN_PASSCODE 환경변수가 아직 없습니다 (8자 이상)." });
      return;
    }
    const b = auth.readBody(req);
    if (!auth.checkPasscode(b.passcode)) {
      await sleep(600); // 무차별 대입을 느리게
      res.status(401).json({ ok: false, error: "bad_passcode" });
      return;
    }
    const s = auth.issueSession();
    res.setHeader("Set-Cookie", auth.cookieHeader(s.value, s.maxAge));
    res.status(200).json({ ok: true, db: db.hasEnv() });
    return;
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", auth.cookieHeader("", 0));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ ok: false, error: "method" });
};
