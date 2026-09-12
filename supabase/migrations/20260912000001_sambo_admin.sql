-- 삼보수산(홍합몰) 어드민 — UTM 빌더 · 짧은 링크 · 성과 대시보드
-- Supabase SQL Editor 에 이 파일 내용을 통째로 붙여넣고 Run 하면 된다. 여러 번 실행해도 안전하다.
-- 표 이름은 전부 sambo_ 로 시작한다. 브라우저는 이 표에 직접 닿지 않고, 서버(Vercel 함수)만 service_role 로 접근한다.

create extension if not exists pgcrypto;

-- 1) 채널 등록부: 빌더에서 카드로 고르는 목록 ---------------------------------
create table if not exists public.sambo_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                  -- 짧은 링크 코드의 앞부분. 예: ig-post
  name text not null,                         -- 카드 이름. 예: 인스타 게시물
  source text not null,                       -- utm_source
  medium text not null,                       -- utm_medium
  content_mode text not null default 'free'
    check (content_mode in ('none','serial','date','free')),  -- 소재 코드 제안 방식
  content_prefix text,                        -- serial 일 때 접두어. 예: post → post01, post02
  note text,                                  -- 어디에 거는 링크인지 설명
  sort integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sambo_channels enable row level security;
revoke all on public.sambo_channels from anon, authenticated;
grant select, insert, update on public.sambo_channels to service_role;

-- 삼보수산이 실제로 쓰는 채널. 필요하면 어드민에서 추가·숨기기.
insert into public.sambo_channels (code, name, source, medium, content_mode, content_prefix, note, sort) values
  ('blog',      '네이버 블로그 글',      'naver-blog',    'post',    'serial', 'post', '블로그 글 본문에 거는 링크. 글마다 새 번호',                10),
  ('blog-home', '블로그 프로필·소개',    'naver-blog',    'profile', 'none',   null,   '블로그 프로필·소개글 링크. 하나만 둔다',                    20),
  ('ig-bio',    '인스타 프로필',         'instagram',     'bio',     'none',   null,   '프로필 상단 링크. 하나만 둔다',                             30),
  ('ig-post',   '인스타 게시물',         'instagram',     'post',    'serial', 'post', '게시물 캡션·댓글에 거는 링크. 게시물마다 새 번호',          40),
  ('ig-story',  '인스타 스토리',         'instagram',     'story',   'date',   null,   '스토리 링크 스티커. 올린 날짜(MMDD)가 코드',                50),
  ('threads',   '스레드 글',             'threads',       'post',    'serial', 'th',   '스레드 글에 거는 링크. 글마다 새 번호',                     60),
  ('kakao',     '카카오 채널·1:1 공유',  'kakao',         'dm',      'none',   null,   '카카오톡 채널 메시지·지인에게 직접 보낼 때',                70),
  ('openchat',  '오픈채팅방',            'kakao-openchat','chat',    'free',   null,   '방 이름을 소재 코드로. 예: geoje-mom',                      80),
  ('sponge',    '스폰지클럽 크루',       'sponge',        'crew',    'none',   null,   '스폰지클럽 제출 문서·크루에게 공유하는 링크',               90)
on conflict (code) do nothing;

-- 2) UTM 링크 장부 --------------------------------------------------------------
create table if not exists public.sambo_utm_links (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.sambo_channels(id),
  landing_path text not null default '/',
  source text not null,          -- utm_source
  medium text not null,          -- utm_medium
  campaign text not null,        -- utm_campaign
  content text,                  -- utm_content (없으면 null)
  term text,                     -- utm_term
  url text not null,             -- 완성된 긴 링크
  short_code text,               -- 짧은 링크 코드 (/l/<code>)
  label text,                    -- 메모: "9/16 블로그 제철 글"
  created_by text,
  clicks integer not null default 0,
  last_clicked_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
-- 같은 조합은 한 번만 (content/term 이 null 이어도 유일하게)
create unique index if not exists sambo_utm_links_key
  on public.sambo_utm_links (landing_path, source, medium, campaign, coalesce(content, ''), coalesce(term, ''));
create unique index if not exists sambo_utm_links_short_code_key
  on public.sambo_utm_links (short_code) where short_code is not null;
alter table public.sambo_utm_links enable row level security;
revoke all on public.sambo_utm_links from anon, authenticated;
grant select, insert, update on public.sambo_utm_links to service_role;

-- 3) 클릭 로그 (짧은 링크를 누를 때마다 한 줄) ---------------------------------
create table if not exists public.sambo_link_clicks (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.sambo_utm_links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  device text not null default 'other' check (device in ('mobile','desktop','other')),
  referer_host text
);
create index if not exists sambo_link_clicks_time_idx on public.sambo_link_clicks (clicked_at desc);
create index if not exists sambo_link_clicks_link_idx on public.sambo_link_clicks (link_id, clicked_at desc);
alter table public.sambo_link_clicks enable row level security;
revoke all on public.sambo_link_clicks from anon, authenticated;
grant select, insert on public.sambo_link_clicks to service_role;

-- 4) 랜딩 행동 (view = 랜딩 도달, cta = "스토어에서 쿠폰 받기" 버튼 클릭) --------
-- 개인정보 없음. sid 는 브라우저 세션마다 만드는 임의 문자열이라 사람을 식별하지 않는다.
create table if not exists public.sambo_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('view','cta')),
  sid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  landing_path text,
  device text not null default 'other' check (device in ('mobile','desktop','other')),
  created_at timestamptz not null default now()
);
create index if not exists sambo_events_time_idx on public.sambo_events (created_at desc);
create index if not exists sambo_events_utm_idx on public.sambo_events (utm_source, utm_medium, utm_campaign);
alter table public.sambo_events enable row level security;
revoke all on public.sambo_events from anon, authenticated;
grant select, insert on public.sambo_events to service_role;

-- 5) 클릭 +1 과 클릭 로그를 한 번에 (원자적). 서버만 호출한다. ------------------
create or replace function public.sambo_hit_link(p_code text, p_device text default 'other', p_referer text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_url text; v_id uuid;
begin
  update public.sambo_utm_links
     set clicks = clicks + 1, last_clicked_at = now()
   where short_code = p_code and archived = false
   returning url, id into v_url, v_id;
  if v_id is not null then
    insert into public.sambo_link_clicks (link_id, device, referer_host)
    values (v_id, case when p_device in ('mobile','desktop') then p_device else 'other' end, left(p_referer, 200));
  end if;
  return v_url;
end $$;
revoke all on function public.sambo_hit_link(text, text, text) from public, anon, authenticated;
grant execute on function public.sambo_hit_link(text, text, text) to service_role;
