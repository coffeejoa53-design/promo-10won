/* Supabase PostgREST 를 fetch 로 직접 호출한다. 서버(api/*)에서만 쓴다.
   키는 환경변수에서만 읽고 절대 응답에 싣지 않는다. 외부 패키지 없음. */
const TABLES = {
  channels: "sambo_channels",
  links: "sambo_utm_links",
  clicks: "sambo_link_clicks",
  events: "sambo_events"
};

function env() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key };
}

function hasEnv() {
  const e = env();
  return Boolean(e.url && e.key);
}

async function rest(path, opts) {
  opts = opts || {};
  const e = env();
  if (!e.url || !e.key) throw new Error("no_db");
  const headers = Object.assign({
    apikey: e.key,
    Authorization: "Bearer " + e.key,
    "Content-Type": "application/json",
    Prefer: opts.prefer || "return=representation"
  }, opts.headers || {});
  const r = await fetch(e.url + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
  if (!r.ok) {
    const err = new Error("db_error " + r.status + " " + (data && data.message ? data.message : String(text).slice(0, 200)));
    err.status = r.status;
    err.detail = data;
    throw err;
  }
  return data;
}

/* PostgREST 는 한 번에 최대 1000행. 전부 가져올 때는 페이지를 돈다. */
async function restAll(path) {
  const page = 1000;
  let from = 0;
  let out = [];
  for (;;) {
    const rows = await rest(path, {
      headers: { Range: from + "-" + (from + page - 1), "Range-Unit": "items" },
      prefer: "count=none"
    });
    if (!Array.isArray(rows)) break;
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
    if (from > 50000) break;
  }
  return out;
}

async function rpc(name, args) {
  const e = env();
  if (!e.url || !e.key) throw new Error("no_db");
  const r = await fetch(e.url + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: e.key, Authorization: "Bearer " + e.key, "Content-Type": "application/json" },
    body: JSON.stringify(args || {})
  });
  const text = await r.text();
  if (!r.ok) throw new Error("rpc_error " + r.status + " " + text.slice(0, 200));
  try { return JSON.parse(text); } catch (_) { return text; }
}

module.exports = { TABLES, hasEnv, rest, restAll, rpc };
