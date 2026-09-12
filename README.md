# promo-10won — 홍합몰 이벤트 랜딩 + 어드민

- 랜딩: https://promo-10won.vercel.app (`index.html`, 정적)
- 어드민: https://promo-10won.vercel.app/admin — UTM 링크 빌더 · 짧은 링크 · 성과 대시보드
- 세팅 순서와 인수인계: [`docs/어드민_설정_안내.md`](docs/어드민_설정_안내.md)

## 구조

```
index.html                 랜딩 (맨 아래 track.js 한 줄만 추가됨)
track.js                   랜딩 유입 기록 (utm 보관 · view/cta 전송, 개인정보 없음)
admin/index.html           어드민 화면 (정적, API 호출)
api/l.js                   /l/<code> 짧은 링크 → 클릭 집계 → 302
api/track.js               랜딩 행동 수집
api/admin/session.js       로그인·로그아웃
api/admin/channels.js      채널 등록부
api/admin/links.js         UTM 링크 장부
api/admin/stats.js         성과 집계
lib/utm.js                 UTM 값 규칙 (서버·브라우저 공용)
lib/db.js                  Supabase REST 호출 (서버 전용)
lib/auth.js                어드민 세션
supabase/migrations/       표·함수 SQL (Supabase SQL Editor 에 붙여넣기)
vercel.json                /l/:code rewrite · noindex 헤더
```

## 환경변수 (Vercel)

`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `ADMIN_PASSCODE` — 값은 코드·문서 어디에도 적지 않는다.

## 규칙

- UTM 값은 소문자·영문·숫자·하이픈만. 한글 금지. 한 번 정한 이름은 바꾸지 않는다.
- 짧은 링크는 302 + no-store. 봇·HEAD 는 세지 않는다. 목적지는 DB 의 url 뿐.
- 숫자는 서버가 실제로 센 값만 보여 준다.
