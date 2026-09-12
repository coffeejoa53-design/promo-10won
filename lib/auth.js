/* 어드민 인증 — 환경변수 ADMIN_PASSCODE 하나로 동작한다.
   로그인하면 HMAC 서명된 세션 쿠키(httpOnly)를 준다. 비밀번호 자체는 어디에도 저장하지 않는다. */
const crypto = require("crypto");

const COOKIE = "sambo_admin";
const MAX_AGE = 60 * 60 * 12; // 12시간

function passcode() {
  return process.env.ADMIN_PASSCODE || "";
}

function hasPasscode() {
  return passcode().length >= 8;
}

function key() {
  return crypto.createHash("sha256").update("sambo-admin-session:" + passcode()).digest();
}

function sign(payload) {
  return crypto.createHmac("sha256", key()).update(payload).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // 길이가 달라도 시간을 비슷하게 쓴다
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function checkPasscode(input) {
  if (!hasPasscode()) return false;
  return safeEqual(String(input || ""), passcode());
}

function issueSession() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return { value: exp + "." + sign(exp), maxAge: MAX_AGE };
}

function verifySession(token) {
  if (!token || !hasPasscode()) return false;
  const i = token.indexOf(".");
  if (i < 1) return false;
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, sign(exp));
}

function parseCookies(req) {
  if (req.cookies && typeof req.cookies === "object") return req.cookies;
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(function (part) {
    const j = part.indexOf("=");
    if (j > 0) out[part.slice(0, j).trim()] = decodeURIComponent(part.slice(j + 1).trim());
  });
  return out;
}

function isAdmin(req) {
  return verifySession(parseCookies(req)[COOKIE]);
}

function cookieHeader(value, maxAge) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

/* 관리용 API 첫 줄. 통과하면 true, 아니면 401 을 보내고 false */
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return {};
}

module.exports = { COOKIE, hasPasscode, checkPasscode, issueSession, verifySession, isAdmin, cookieHeader, requireAdmin, readBody };
