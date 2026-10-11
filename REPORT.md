# Report

- **Production URL:** https://tech-stack-scout-zeta.vercel.app
- **Repo URL:** pending: waiting on GitHub CLI login (see BLOCKED.md)
- **DEMO_PASSCODE:** see README "For graders"
- Status: **interim**, written before GitHub, Gemini and Gmail credentials were available.

## Checks run

| Check | Result |
|---|---|
| node 24.19, npm 11.17, git 2.53 present; gh 2.102 and Vercel CLI 63.1 installed; neonctl 8.3 via npx | Pass |
| Vercel login, Neon login | Pass |
| GitHub CLI login | **Blocked** (waiting on you) |
| Neon project `tech-stack-scout` (aws-ap-southeast-1), pooled URL in `.env`, migrations applied (13 tables) | Pass |
| Product profile + 241-entry dictionary seeded | Pass |
| `verify-seed`: 10 companies pass (3 Indian, 1 thin) | Pass |
| `tsc --noEmit`, `next build` | Pass |
| Unit tests (`npm test`) | Pass: 43/43 |
| Replay (`npm run replay`), 8 scenarios | Pass: 31/31 checks |
| Live local pipeline, Sweetgreen (thin) and Linear (rich, GitHub unauthenticated) | Pass (partial: brief pending without Gemini key; GitHub rate-limited without token) |
| Local: all pages 200, writes 401 without passcode, wrong passcode rejected, add-by-domain returns at once and steps progress, refresh within 10 min returns cached run | Pass |
| Local: 375 px width, no horizontal scroll on the brief page | Pass |
| Production deploy, all pages 200, cron without secret → 401 | Pass |
| Gemini briefs, blog extraction | Pending `GEMINI_API_KEY` |
| Digest email | Pending Gmail credentials |
| Seed refresh on production data, full browser verification | Pending the above |

## verify:true items for you to review

- Dictionary: **Heroku** (`Procfile`, `app.json` are generic), **AWS Lambda** (`template.yaml` is generic).
- Competitor: **BuildPulse**: official docs did not show the GitHub Action name, so `buildpulse/buildpulse-action` is unconfirmed.
- Mark either verified in /settings after checking.

## Vercel Hobby limits found

Functions: 300 s default and max. Cron: once per day, ±59 min. Details and consequences in DECISIONS.md.

## Blocked

See BLOCKED.md.
