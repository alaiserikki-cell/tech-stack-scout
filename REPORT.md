# Report

- **Production URL:** https://tech-stack-scout-zeta.vercel.app
- **Repo URL:** https://github.com/alaiserikki-cell/tech-stack-scout
- **DEMO_PASSCODE:** `amber-kite-birch`
- Verified on 2026-10-11.

## Checks run

| # | Check | Result |
|---|---|---|
| 1 | Tooling: node 24.19, npm 11.17, git 2.53, gh 2.102 (installed), Vercel CLI 63.1 (installed), neonctl 8.3 via npx | Pass |
| 2 | Logins: GitHub (alaiserikki-cell), Vercel, Neon | Pass |
| 3 | Neon project `tech-stack-scout` (aws-ap-southeast-1), pooled URL, Drizzle migrations (13 tables) | Pass |
| 4 | Product profile + 241-entry dictionary seeded | Pass |
| 5 | `verify-seed`: 10 seed companies, 3 Indian (Meesho, Razorpay, Postman), 1 thin (Rothy's) | Pass |
| 6 | `tsc --noEmit`, `next build` | Pass |
| 7 | Unit tests `npm test` | Pass: 44/44 |
| 8 | Replay `npm run replay`: rich, sdk_heavy, no GitHub, no job board, invented blog mention, invalid Gemini JSON, GitHub 403, Gemini 429 | Pass: 31/31 checks |
| 9 | Gemini keys: key 2 and key 3 valid, key 1 rejected (401); key 2 in use | Pass |
| 10 | Full refresh of all 13 watchlist companies (10 seed + PostHog, Supabase, Sweetgreen) | Pass: 13/13 with a validated brief or `skipped_unchanged`; 0 corrupted briefs |
| 11 | Hash skip: unchanged companies returned `skipped_unchanged` with no Gemini call | Pass |
| 12 | Thin company (Rothy's): "No public GitHub found. Here's what we checked", empty opener because nothing connects | Pass |
| 13 | Production: all 8 pages return 200 logged out, no error text | Pass |
| 14 | Production: refresh via API steps through Reading GitHub → Reading blog → Writing brief → success | Pass (~18 s) |
| 15 | Production: cron without secret → 401; with secret → refreshed 4 due companies in 143 s (under the 210 s budget), digest "not Monday" | Pass |
| 16 | Production: digest emailed via API to `DIGEST_TO` (Resend), links point to production; invalid address rejected; a non-owner address gets a clear explanation (422) and the digest page shows the exact email | Pass |
| 17 | Local (same code + DB): passcode form (wrong passcode rejected, right one accepted), add company by domain in UI → redirected with live step indicator → brief written | Pass |
| 18 | Writes without passcode → 401; refresh within 10 min → cached run; opener feedback; source confirm; bad source edit rejected | Pass |
| 19 | 375 px width: no horizontal scroll on watchlist and brief pages (production and local) | Pass |
| 20 | Secret scan of all git history before making the repo public | Pass: no secrets found |

Bug found and fixed during verification: a regex that removes inline `[12, 13]` citations from brief prose lost its backslashes and deleted every "s" and "d". Fixed, covered by a new unit test, affected briefs reset and regenerated.

Not done in the browser: typing the passcode into the **production** site (my safety rules allow it only on localhost). The same flows were verified on localhost and against production through its API.

## verify:true items for you to review (/settings)

- Dictionary: **Heroku** (`Procfile`, `app.json` are generic), **AWS Lambda** (`template.yaml` is generic).
- Competitor: **BuildPulse**: official docs did not show the GitHub Action name, so `buildpulse/buildpulse-action` is unconfirmed.

## Vercel Hobby limits found

- Functions: 300 s default and maximum → `maxDuration = 300`; cron stops starting work at 210 s.
- Cron: once per day, ±59 min → `30 2 * * *` (08:00 IST).

## Known limit (accepted)

Email uses the aangan Resend account without a verified sending domain, so it only delivers to that account's own inbox (the alaiserikki Gmail, which is `DIGEST_TO`). The Monday digest arrives there. On /digests/[id] graders see the exact email in a preview, and "Email me this digest" to another address explains the restriction instead of failing silently. Decision: accepted for submission (option 3). Fix later with a verified Resend domain or Gmail SMTP credentials.
