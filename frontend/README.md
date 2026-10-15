# SportArenaGlobal — Frontend

Website (React + TypeScript + Vite) — public catalogue, sign-up/sign-in and the signed-in app. See the [repository root README](../README.md) for the full run instructions.

```bash
npm install
npm run dev      # local dev server, http://localhost:5173
npm run build    # type-check + production build into dist/
npm run lint     # oxlint
npm test         # Vitest
```

Configuration: `VITE_API_BASE_URL` (see `.env.development`) points the app at the backend API.

Auth in the browser: the session is an HttpOnly cookie (`credentials: "include"` in `src/api/client.ts`); the only thing held in JS is the session-bound CSRF token (memory only, sent as `X-CSRF-Token` on changes). Nothing secret goes into `localStorage`. Pages: `src/components/auth/`, public site: `src/components/public/`, routing: `src/router.ts` + `src/App.tsx`. See [docs/auth.md](../docs/auth.md).

Optional build variable: `VITE_SUPPORT_EMAIL` — contact address shown on the legal pages.
