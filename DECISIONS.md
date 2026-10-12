# Decisions log

Each entry: decision, alternatives considered, why.

## Platform and tooling

| Decision | Alternatives | Why |
|---|---|---|
| Project lives in `Desktop/tech-stack-scout`, its own git repo | Inside the movie-matchmaker repo | Separate graded project; avoids mixing histories. |
| Next.js 16.4 App Router with Cache Components + Partial Prefetching (the `create-next-app@latest` defaults) | Turn Cache Components off | Every page renders a static shell and streams live Neon data inside `<Suspense>` with a skeleton fallback; data components call `await connection()` first. This gives the skeleton loaders the design asks for at no extra cost. |
| `after()` from `next/server` for post-response refreshes | `waitUntil` from `@vercel/functions` | Next 16 docs: `after` runs for the route's `maxDuration` on Vercel and is the framework-native API. |
| Drizzle ORM over `drizzle-orm/neon-http` with the pooled Neon URL | WebSocket `Pool` driver | Stateless HTTP queries suit serverless; no interactive transactions are needed. A custom `fetchFunction` retries once to absorb Neon cold starts. |
| Neon project `tech-stack-scout` in `aws-ap-southeast-1` (Singapore) | ap-south-1 (Mumbai) | Singapore is the closest Neon region to India offered for this account. |
| `neonctl` used through `npx` instead of a global install | `npm i -g neonctl` | A different global package already owns the `neon` command on this machine; `npx neonctl` avoids clobbering it. |
| Gemini model `gemini-3.8-flash` | `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash` | Google's models page lists 3.8 Flash as the latest stable Flash model recommended for new projects (checked 2026-10-11). |
| Display rates $0.75 input / $3.75 output per 1M tokens | Jan-2027 rates ($1.50 / $7.50) | Google pricing page: standard paid rates for gemini-3.8-flash through 31 Dec 2026. Shown for estimation only; free tier = zero spend. |
| SDK call: `ai.models.generateContent({ config: { responseMimeType: "application/json", responseJsonSchema, thinkingConfig: { thinkingLevel: LOW } } })` | `interactions.create` with `response_format` | Both exist in `@google/genai` 2.28; `generateContent` exposes `usageMetadata` token counts needed for /costs. Verified against the SDK's own type definitions. |
| Thinking level LOW | default (dynamic) | Briefs are rewriting tasks; lower latency and fewer billed tokens. |

## Vercel Hobby limits (checked 2026-10-11 on vercel.com/docs)

- Functions: 300 s default **and** maximum duration on Hobby (Fluid compute). `maxDuration = 300` on the cron, add and refresh routes.
- Cron: up to 100 jobs per project, but Hobby may only run **once per day**, with **hour-level precision (±59 min)**. Schedule `30 2 * * *` (02:30 UTC = 08:00 IST).
- Consequence: one daily cron refreshes companies sequentially, oldest first, and stops starting new work at 70% of 300 s (210 s). At ~30–60 s per company that is roughly 4–7 refreshes a day, i.e. 28–49 a week, which covers the 40-company cap at least weekly. Companies added from the dashboard refresh immediately via `after()`.

| Email via Resend HTTP API (`RESEND_API_KEY`, from `onboarding@resend.dev`), same setup as the aangan-enquiry-agent project; Gmail SMTP via Nodemailer kept as fallback | Gmail SMTP only (spec) | You asked to send email the same way as aangan. That Resend account has no verified domain, so it can only deliver to its own sign-up address, which is the alaiserikki Gmail; `DIGEST_TO` is set to it. A verified domain (`RESEND_FROM`) or Gmail credentials would allow any recipient. |

| Demo passcode switched **off** by default (`REQUIRE_PASSCODE=true` turns it back on) | Passcode on all writes (spec) | Your instruction: graders must be able to test everything from the URL with no passcode. Rate limits (refresh 1 per company per 10 min, 10 adds/day, 40 active, email 3 per address and 20 per day) still protect the free tiers. |

| Neon Postgres kept instead of Supabase | Move to Supabase (problem statement wording) | Your decision. Your build brief specified Neon; both are hosted Postgres, and Nikhil adds or removes companies in Neon's table editor (or the dashboard) without touching code. |
| Conference talks via Hacker News (Algolia) links to YouTube, Vimeo, InfoQ, SpeakerDeck | YouTube Data API | The problem statement lists conference talks as a source. The Gemini key is rejected by the YouTube API (it needs OAuth), so talks are found key-free. Precision rule: the company must own the talk, or the title must pair it with a technology and an engineering topic. |

| App renamed to **FlakeGuard** everywhere (header, tab title, emails, docs) | "Tech Stack Scout" (the project name in the problem statement) | Your request. The name FlakeGuard itself came from the build brief (product-profile.json); the problem statement only says "a developer productivity tool". Repo and Vercel URL keep the tech-stack-scout name so existing links keep working. |
| Dropped the How it works, Costs and System pages; added one **Activity** page (old URLs redirect) | Keep them | Your request: How it works is covered in your viva; every add, remove, refresh, review, digest and daily run is now tracked in one timeline (`activity_log` table). Gemini token usage is still recorded in `llm_calls`. |
| Brief page leads with **At a glance** key points and a **Stack map** diagram built in code; the two paragraphs and full evidence fold away | Show everything | Your request to reduce reading load. Built from computed fields, so no extra Gemini tokens and nothing outside the signals. |
| Digest page: fit-vs-momentum **priority map** (2×2: Call now / Nurture / Watch / Later) plus a ranked top 5 with a why-now pill | Plain list | Your request for a visual. The digest now stores every account so the map is complete; the email still lists the top 5. |
| Added Workday and SmartRecruiters job boards and careers-page discovery | Greenhouse/Lever/Ashby only | Stryker (Workday) showed no jobs before. Enterprises mostly use Workday; its public `wday/cxs` JSON endpoint needs no key. |
| Shopify added to hosting detection | — | Minimalist (a D2C skincare brand) has no public engineering signal; its Shopify storefront is the one real signal. Its jobs are growth and sales roles on aggregators/LinkedIn, which cannot be read automatically. |
| "Add company" in the header opens a dialog from any page | Anchor link to the home page | The old link did nothing visible when already on the home page. |

| Two scores: **Fit** (driven by an editable targeting profile) and **Evidence** (data quality) | One fit score | Your request: Nikhil should be able to say what he wants, and the app should show how trustworthy each brief is. Both are computed in code at read time, so changing targeting re-ranks instantly with no AI cost. |
| Targeting page with chips and an importance level (off/normal/high) per fit factor; optional target clouds | JSON editor only | The problem statement does not say what Nikhil's product needs, so he can define it. Default settings reproduce the original weights exactly (unit-tested). |
| Sources are verified only with proof (org website = company domain; board linked from careers page; feed on company domain); unverified sources earn no evidence points and are excluded from Gemini input | Treat auto-matched sources as true | Your request: verified sources only, nothing invented. |
| How it works page restored, rebuilt after stackscout.ca (colour bands, numbered steps, audience cards) | Keep it removed | Your request after reviewing StackScout. |
| Free features added: bulk add, tech search, CSV export, print to PDF | Paid enrichment APIs | Zero cost: all run in the browser or on existing endpoints. |

| Cleanup every 2 months with 60-day retention, protecting everything the site still shows | Delete all data older than N days | Your request. Verified on a throwaway Neon branch with retention forced to 0 days: 8,209 old facts removed, every company kept its brief and every brief kept its sources. Postgres reuses freed space rather than shrinking the file immediately; Neon autovacuum handles that. |

## Data and matching

| Decision | Alternatives | Why |
|---|---|---|
| Competitor detection strings only from vendor docs; BuildPulse kept `verify:true` | Guessing the BuildPulse action name | Trunk (`trunk-io/analytics-uploader`), Datadog (`dd-trace/ci/init`, `dd-trace/ci/cypress`), Launchable (`launchable`, `smart-tests-cli`, `launchable record tests`), Develocity (`com.gradle.develocity`, `com.gradle.enterprise`), Buildkite (`buildkite-test-collector`) were confirmed in official docs. BuildPulse docs did not show an action name, so its entry stays unverified and is excluded from matching. Datadog's official GitHub Action owner/name was not shown in docs, so it is not listed. |
| Bare-word competitor strings (e.g. `launchable`) match exact dependency names only; strings with `/`, `.` or spaces also match workflow/manifest text | Substring match everywhere | Avoids false positives from prose. |
| Dictionary of 241 entries generated by `scripts/build-dictionary.mjs` | Hand-written JSON | Sanity checks (lowercase aliases, no duplicates, size 150–250) run on every regeneration. |
| Ambiguous words only as phrases: Go → `golang`, `go developer`…; Rust/Swift/R/C/Julia/Zig/Dart only with tech context; Spark only as `apache spark`, `pyspark`…; `Express`, `Envoy`, `Detox`, `Hypothesis`, `Jasmine`, `Renovate`, `Electron` never as bare words | Bare names | These words are common English. |
| Dictionary `verify:true` (excluded until verified in /settings): **Heroku** (detection file `Procfile`/`app.json` are used by other platforms), **AWS Lambda** (`template.yaml` is generic) | Leave active | Detection files are too generic to trust automatically. |
| Org discovery: candidates = domain stem, company name variants, top-5 GitHub org search results; accept an org whose profile website contains the domain, else an org whose login equals the domain stem | Take the first search hit | Prevents attaching an unrelated org. Saved as unverified either way. |
| Job post sections: headings detected from `<h1-6>`, bold-only paragraphs, Lever list titles and short lines ending in ":" | Treat the whole post as requirements | Needed for requirement vs nice_to_have tagging. Lines saying "is a plus" / "preferred" are nice_to_have even under a requirements heading. |
| Initiative sentences that appear in more than half of a company's postings are dropped as boilerplate | Keep all | GitLab-style company intros repeat in every post ("increase developer productivity") and are not initiatives. |
| Blog posts are fetched once; earlier posts (≤90 days) are carried forward into each new run's signal set | Re-fetch every run | Spec says skip stored URLs; carrying forward keeps briefs and hashes stable. |
| Hash excludes timestamps and buckets volatile counts (language % to 5, job count to 5, repo activity to the label) | Hash raw values | Otherwise every refresh would look "changed" and spend a Gemini call. |
| "Dropped" only counts runs where both the GitHub and jobs collectors succeeded | Count every run | A collector outage must not mark technologies as dropped. |
| On `skipped_unchanged`, no new signals are stored; the previous snapshot and its signal ids remain current | Store new signals | Keeps the reused brief's citations valid. |
| Gemini brief input: one representative signal per (source, technology) with a `job_posts_mentioning` count, up to 10 initiatives, 5 posts, 5 HN stories, 8 job titles | All raw signals | Keeps prompts under ~8k tokens on the free tier; ids still point to real stored signals. |
| Validator checks technology names by running the dictionary matcher (patterns excluded) over every output field, against technologies found anywhere in the input signals | Only check `name` fields | Catches technologies slipped into prose. |
| Remove company = `active=false` | Hard delete | Keeps history; re-adding reactivates. |
| Digest recipients stored only as a SHA-256 prefix | Plain addresses | Addresses are never displayed or logged. |
| Dashboard adds are `added_by = demo`; DB-console rows default to `nikhil` | — | Matches the spec's two actors. |

## Seed companies (from `scripts/verify-seed.ts`, run 2026-10-11)

Meesho, Razorpay, Postman (Indian tech companies), Rothy's (deliberately thin: no GitHub org, one Ashby engineering role, a Shopify blog without engineering posts), Spotify, Vercel, Stripe, Notion, Linear, GitLab. Sweetgreen was first picked as the thin company, but GitHub discovery then found its real org (github.com/sweetgreen, 67 repos, website matches), so verify-seed now probes the domain stem for thin candidates and Rothy's replaced it; Sweetgreen stays on the watchlist as a normal company. Failed checks: Ramp (no GitHub org `ramp`), PhonePe, Hasura (no public board/feed found), Groww (no GitHub org), Allbirds (nothing found).

## Visual direction (revised 2026-10-11, after Common Room by Zoom)

You asked for the look of Common Room (commonroom.io, by Zoom), a buyer-intelligence product close to this one.

- **Canvas:** light sage background (#f3f7f5) with a soft mint wash at the top; white cards with 16px radius and a soft shadow.
- **Type:** Inter Tight (bold, tight tracking) for headings, Inter for body. Headlines carry one mint-highlighted phrase, as Common Room does.
- **Colour:** charcoal ink #2d2d2d for text and primary buttons; one mint accent (#1bc88c fills, #0b8a5f text for AA contrast) for pills, highlights, the fit ring and progress; amber only for competitors, red only for stale data.
- **Components:** mint "eyebrow" pills, charcoal buttons, a single-bar add form (input + button) like Common Room's email capture, stat tiles, a fit-score ring drawn with a CSS conic-gradient (no chart library), level pills for activity and coverage, letter avatars.
- **Brief page:** header card with fit ring and pills, mint-topped opener card with the opener at 21-26px, check-marked "Already answered" and question-marked "Still unknown" cards, evidence below.
- **Dark mode:** same structure on a deep green-black, mint accent brightened.
- **Phone:** nav becomes a horizontal strip under the logo; no horizontal page scroll at 375px.
