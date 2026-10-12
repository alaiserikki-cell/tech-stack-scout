import { and, desc, eq, inArray, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { COLLECTORS, runCollector } from "@/collectors";
import { BLOG_WINDOW_DAYS, isEngineeringPost } from "@/collectors/blog";
import type { BlogExtraction, CollectorContext, CompanyInput, Signal, Source } from "./types";
import { changeEvents, computeFields, signalHash, updateTechState, type Computed, type TechStateRow, type VerifiableSource } from "./compute";
import { BLOG_JSON_SCHEMA, BLOG_SYSTEM, NO_SIGNAL_TEXT, generateBrief, selectBriefSignals } from "./brief";
import { callGemini, geminiConfigured, geminiModel, GeminiQuotaError } from "./gemini";
import { dbCache, latestSnapshot, loadDictionary, loadProfile, logLlmCall } from "./repo";
import { logActivity } from "./activity";

const DAY = 86_400_000;

export const STEPS = ["Finding sources", "Reading GitHub", "Reading job posts", "Reading blog", "Writing brief"] as const;

/**
 * A run cut off mid-way (the platform's 300 s limit, a deploy) would stay "running" forever and block that company.
 * Anything queued/running for over 15 minutes is marked failed; the previous brief stays in place.
 */
/** Bump when computed fields change meaning (3: non-engineering job titles excluded from language counts). */
export const COMPUTE_VERSION = 3;

export async function sweepStuckRuns(): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.refreshRuns)
    .set({ status: "failed", step: "Timed out", finishedAt: new Date(), collectorErrors: { pipeline: "timed out; previous brief kept" } })
    .where(and(inArray(schema.refreshRuns.status, ["queued", "running"]), lt(schema.refreshRuns.startedAt, new Date(Date.now() - 15 * 60_000))))
    .returning({ id: schema.refreshRuns.id });
  return rows.length;
}

export async function createRun(companyId: number, trigger: "cron" | "manual" | "on_add"): Promise<number> {
  const db = getDb();
  await sweepStuckRuns();
  const [r] = await db.insert(schema.refreshRuns).values({ companyId, trigger, status: "queued", step: "Queued" }).returning({ id: schema.refreshRuns.id });
  return r.id;
}

/** Returns an in-flight or very recent (<10 min) run for the company, if any. */
export async function recentRun(companyId: number, withinMs = 10 * 60_000) {
  const db = getDb();
  const [r] = await db
    .select()
    .from(schema.refreshRuns)
    .where(and(eq(schema.refreshRuns.companyId, companyId), gte(schema.refreshRuns.startedAt, new Date(Date.now() - withinMs))))
    .orderBy(desc(schema.refreshRuns.startedAt))
    .limit(1);
  return r ?? null;
}

function toCompanyInput(c: typeof schema.watchlist.$inferSelect): CompanyInput {
  return {
    id: c.id,
    companyName: c.companyName,
    domain: c.domain,
    githubOrg: c.githubOrg,
    githubOrgVerified: c.githubOrgVerified,
    atsProvider: c.atsProvider,
    atsSlug: c.atsSlug,
    atsVerified: c.atsVerified,
    blogFeedUrl: c.blogFeedUrl,
    blogVerified: c.blogVerified,
  };
}

export function rowToSignal(r: typeof schema.signals.$inferSelect): Signal {
  return {
    id: r.id,
    source: r.source as Source,
    kind: r.kind,
    name: r.name,
    detail: r.detail,
    requirementLevel: (r.requirementLevel as Signal["requirementLevel"]) ?? null,
    confidence: (r.confidence as Signal["confidence"]) ?? null,
    evidenceUrl: r.evidenceUrl,
    observedAt: r.observedAt.toISOString(),
  };
}

export async function executeRun(runId: number): Promise<void> {
  const db = getDb();
  const setRun = (v: Partial<typeof schema.refreshRuns.$inferInsert>) => db.update(schema.refreshRuns).set(v).where(eq(schema.refreshRuns.id, runId));
  const [run] = await db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.id, runId));
  if (!run) return;
  const [companyRow] = await db.select().from(schema.watchlist).where(eq(schema.watchlist.id, run.companyId));
  if (!companyRow) return;
  const now = new Date();
  const errors: Record<string, string> = {};
  try {
    await setRun({ status: "running", step: "Finding sources", startedAt: now });
    const [dict, profile] = await Promise.all([loadDictionary(), loadProfile()]);
    const company = toCompanyInput(companyRow);

    const prevBlogRows = await db
      .select()
      .from(schema.signals)
      .where(and(eq(schema.signals.companyId, company.id), eq(schema.signals.source, "blog"), gte(schema.signals.observedAt, new Date(now.getTime() - BLOG_WINDOW_DAYS * DAY))));
    // posts whose Gemini extraction did not succeed are fetched again so they get extracted
    const seenBlogUrls = new Set(
      // a post counts as read only once it was classified (engineering or not); older rows are read again
      prevBlogRows
        .filter((r) => r.kind === "blog_post" && r.evidenceUrl && (r.detail as Record<string, unknown>).extraction === "ok" && typeof (r.detail as Record<string, unknown>).about_engineering === "boolean")
        .map((r) => r.evidenceUrl!),
    );

    const extractBlog = geminiConfigured()
      ? async (title: string, text: string): Promise<BlogExtraction | null> => {
          try {
            const r = await callGemini({ system: BLOG_SYSTEM, prompt: `TITLE: ${title}\n\nTEXT:\n${text}`, schema: BLOG_JSON_SCHEMA, task: "blog_extract" });
            let parsed: BlogExtraction | null = null;
            try {
              parsed = JSON.parse(r.text);
            } catch {
              parsed = null;
            }
            await logLlmCall({ task: "blog_extract", model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, status: parsed ? "ok" : "invalid", companyId: company.id });
            return parsed;
          } catch (e) {
            await logLlmCall({ task: "blog_extract", model: geminiModel(), inputTokens: 0, outputTokens: 0, status: e instanceof GeminiQuotaError ? "quota" : "error", companyId: company.id });
            return null;
          }
        }
      : undefined;

    const ctx: CollectorContext = {
      company,
      dict,
      profile,
      fetch,
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
      cache: dbCache,
      seenBlogUrls,
      extractBlog,
      now,
    };

    const collected: Signal[] = [];
    const checked: Record<string, string[]> = {};
    for (const c of COLLECTORS) {
      await setRun({ step: c.step });
      const out = await runCollector(c, ctx);
      checked[c.name] = out.checked;
      if (out.error) errors[c.name] = out.error;
      collected.push(...out.signals);
      if (out.updates && Object.keys(out.updates).length) {
        Object.assign(ctx.company, out.updates);
        await db.update(schema.watchlist).set(out.updates).where(eq(schema.watchlist.id, company.id));
      }
    }

    // a source that is down or rate-limited this time keeps its facts from the last good refresh,
    // so an outage never makes technologies "disappear" from a brief
    const failedSources = COLLECTORS.map((c) => c.name).filter((n) => errors[n] && !collected.some((s) => s.source === n));
    const lastGood = failedSources.length ? await latestSnapshot(company.id) : null;
    if (lastGood?.runId) {
      const kept = await db.select().from(schema.signals).where(and(eq(schema.signals.runId, lastGood.runId), inArray(schema.signals.source, failedSources)));
      for (const r of kept) {
        const s = rowToSignal(r);
        delete s.id;
        collected.push(s);
      }
      for (const n of failedSources) checked[n] = [...(checked[n] ?? []), "Unavailable this time; facts from the previous refresh kept"];
    }

    // carry forward blog evidence from earlier runs (posts are only fetched once)
    const newBlogUrls = new Set(collected.filter((s) => s.source === "blog").map((s) => s.evidenceUrl));
    // only classified engineering posts (and their verified tech mentions) are carried forward
    const keptPosts = new Set(
      prevBlogRows.filter((r) => r.kind === "blog_post" && (r.detail as Record<string, unknown>).about_engineering === true).map((r) => r.evidenceUrl),
    );
    for (const r of prevBlogRows) {
      if (newBlogUrls.has(r.evidenceUrl)) continue;
      if (!keptPosts.has(r.evidenceUrl)) continue;
      const s = rowToSignal(r);
      delete s.id;
      collected.push(s);
    }
    // de-duplicate carried rows
    const uniq = new Map<string, Signal>();
    for (const s of collected) uniq.set(`${s.source}|${s.kind}|${s.name}|${s.evidenceUrl}|${s.requirementLevel ?? ""}`, s);
    const signals = [...uniq.values()];

    // only verified sources are used: an auto-matched, unproven source could be another company's.
    // Its signals are stored for audit, but nothing is computed, scored or shown from them until confirmed.
    const unconfirmed = (
      [
        ["github", ctx.company.githubOrgVerified],
        ["jobs", ctx.company.atsVerified],
        ["blog", ctx.company.blogVerified],
      ] as const
    )
      .filter(([src, ok]) => !ok && signals.some((x) => x.source === src))
      .map(([src]) => src as VerifiableSource);
    const isUsable = (s: Signal) => !unconfirmed.includes(s.source as VerifiableSource);
    // COMPUTE_VERSION is part of the hash so a change in how fields are computed re-runs every company
    const hash = `${signalHash(signals.filter(isUsable))}:${COMPUTE_VERSION}`;
    const prevSnap = await latestSnapshot(company.id);
    let prevHash: string | null = null;
    if (prevSnap?.runId) {
      const [pr] = await db.select({ h: schema.refreshRuns.inputHash }).from(schema.refreshRuns).where(eq(schema.refreshRuns.id, prevSnap.runId));
      prevHash = pr?.h ?? null;
    }
    const techStateRows = await db.select().from(schema.techState).where(eq(schema.techState.companyId, company.id));

    if (prevSnap && prevHash === hash && ["ok", "none"].includes(prevSnap.briefStatus) && !Object.keys(errors).length) {
      // unchanged: reuse previous snapshot and brief, no Gemini call
      await logLlmCall({ task: "brief", model: geminiModel(), inputTokens: 0, outputTokens: 0, status: "skipped_unchanged", companyId: company.id });
      await db.update(schema.watchlist).set({ lastRefreshedAt: now }).where(eq(schema.watchlist.id, company.id));
      await setRun({ status: "skipped_unchanged", step: "Done", inputHash: hash, collectorErrors: errors, finishedAt: new Date() });
      await logActivity("refresh_finished", `${company.companyName}: nothing changed, previous brief kept`, { companyId: company.id, actor: run.trigger === "cron" ? "cron" : "system", detail: { runId, status: "skipped_unchanged" } });
      return;
    }

    // persist signals
    const inserted: Signal[] = [];
    for (let i = 0; i < signals.length; i += 200) {
      const chunk = signals.slice(i, i + 200);
      const rows = await db
        .insert(schema.signals)
        .values(
          chunk.map((s) => ({
            companyId: company.id,
            runId,
            source: s.source,
            kind: s.kind,
            name: s.name,
            detail: s.detail,
            requirementLevel: s.requirementLevel ?? null,
            confidence: s.confidence ?? null,
            evidenceUrl: s.evidenceUrl,
            observedAt: new Date(s.observedAt),
          })),
        )
        .returning();
      inserted.push(...rows.map(rowToSignal));
    }

    // tech_state: adopted / dropped
    const dictNames = new Set(dict.map((d) => d.canonical_name));
    const seen = new Map<string, string>();
    const fromVerified = inserted.filter(isUsable);
    for (const s of fromVerified) if (s.kind === "tech" || (s.kind === "language" && dictNames.has(s.name))) seen.set(s.name, s.observedAt);
    const prevState: TechStateRow[] = techStateRows.map((r) => ({
      tech: r.tech,
      status: r.status as TechStateRow["status"],
      firstSeen: r.firstSeen.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      missingRuns: r.missingRuns,
    }));
    // a source that failed or is unconfirmed this run says nothing about technologies being dropped
    const countMissing = !errors.github && !errors.jobs && !unconfirmed.includes("github") && !unconfirmed.includes("jobs");
    const ts = updateTechState(prevState, seen, now, countMissing);
    for (const r of ts.next) {
      await db
        .insert(schema.techState)
        .values({ companyId: company.id, tech: r.tech, status: r.status, firstSeen: new Date(r.firstSeen), lastSeen: new Date(r.lastSeen), missingRuns: r.missingRuns })
        .onConflictDoUpdate({
          target: [schema.techState.companyId, schema.techState.tech],
          set: { status: r.status, lastSeen: new Date(r.lastSeen), missingRuns: r.missingRuns },
        });
    }

    // update per-signal confidence after computing
    const computed = computeFields({ signals: fromVerified, dict, profile, techState: ts.next, newTechs: new Set(ts.newTechs), hasPreviousRun: Boolean(prevSnap), checked, now });
    computed.hash = hash;
    const events = changeEvents(computed, (prevSnap?.computed as Computed) ?? null, prevSnap ? ts.newTechs : [], ts.dropped, now);

    const confByTech = new Map(computed.techs.map((t) => [t.name, t.confidence]));
    for (const conf of ["high", "medium", "low"] as const) {
      const ids = fromVerified.filter((s) => (s.kind === "tech" || s.kind === "language") && confByTech.get(s.name) === conf).map((s) => s.id!);
      for (let i = 0; i < ids.length; i += 500) await db.update(schema.signals).set({ confidence: conf }).where(inArray(schema.signals.id, ids.slice(i, i + 500)));
    }

    if (unconfirmed.length) computed.unconfirmed = unconfirmed;

    // brief
    await setRun({ step: "Writing brief" });
    let brief: unknown = null;
    let briefStatus = "pending";
    let briefError: string | null = null;
    const unverified = [
      companyRow.githubOrg || ctx.company.githubOrg ? (ctx.company.githubOrgVerified ? null : `GitHub org ${ctx.company.githubOrg}`) : null,
      ctx.company.atsProvider && ctx.company.atsProvider !== "none" && !ctx.company.atsVerified ? `${ctx.company.atsProvider} job board ${ctx.company.atsSlug}` : null,
      ctx.company.blogFeedUrl && ctx.company.blogFeedUrl !== "none" && !ctx.company.blogVerified ? `blog feed ${ctx.company.blogFeedUrl}` : null,
    ].filter((x): x is string => Boolean(x));

    if (computed.coverage === "none") {
      brief = { none: true, text: NO_SIGNAL_TEXT, checked };
      briefStatus = "none";
    } else if (!geminiConfigured()) {
      briefStatus = "pending";
      briefError = "GEMINI_API_KEY not configured";
    } else {
      const sigs = selectBriefSignals(fromVerified, computed);
      const outcome = await generateBrief({
        gemini: callGemini,
        profile,
        dict,
        sigs,
        computed,
        events,
        unverified,
        onCall: (r) => logLlmCall({ task: "brief", model: r.model || geminiModel(), inputTokens: r.inputTokens, outputTokens: r.outputTokens, status: r.status, companyId: company.id }),
      });
      if (outcome.status === "ok") {
        brief = outcome.brief;
        briefStatus = "ok";
      } else if (outcome.status === "invalid") {
        briefStatus = "failed";
        briefError = `Validator rejected the brief twice: ${outcome.errors.join("; ").slice(0, 300)}`;
      } else if (outcome.status === "quota") {
        briefStatus = "pending";
        briefError = "Gemini quota exhausted";
      } else {
        briefStatus = "pending";
        briefError = outcome.error;
      }
    }
    if (briefError) errors.brief = briefError;

    // Gemini unavailable or the brief failed validation: keep showing the previous good brief rather than a gap.
    // lastRefreshedAt is not moved, so the daily job tries again tomorrow.
    if (briefStatus !== "ok" && briefStatus !== "none" && prevSnap?.briefStatus === "ok") {
      errors.brief = `${briefError ?? "brief not written"}; previous brief kept`;
      await setRun({ status: "partial", step: "Done", inputHash: hash, collectorErrors: errors, finishedAt: new Date() });
      await logActivity("refresh_finished", `${company.companyName}: new facts collected, brief not rewritten (${briefError ?? "error"}); previous brief kept, retried tomorrow`, {
        companyId: company.id,
        actor: run.trigger === "cron" ? "cron" : "system",
        detail: { runId, status: "partial" },
      });
      return;
    }

    await db.insert(schema.snapshots).values({
      companyId: company.id,
      runId,
      computed,
      brief,
      briefStatus,
      changeEvents: events,
      coverage: computed.coverage,
      fitScore: computed.fit.score,
    });
    await db.update(schema.watchlist).set({ lastRefreshedAt: now }).where(eq(schema.watchlist.id, company.id));
    const partial = Object.keys(errors).length > 0;
    await setRun({ status: partial ? "partial" : "success", step: "Done", inputHash: hash, collectorErrors: errors, finishedAt: new Date() });
    await logActivity(
      "refresh_finished",
      `${company.companyName}: ${events.length ? `${events.length} change${events.length > 1 ? "s" : ""} found` : "refreshed"}, fit ${computed.fit.score}, brief ${briefStatus === "ok" ? "written" : briefStatus}`,
      { companyId: company.id, actor: run.trigger === "cron" ? "cron" : "system", detail: { runId, status: partial ? "partial" : "success" } },
    );
  } catch (e) {
    errors.pipeline = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await setRun({ status: "failed", step: "Failed", collectorErrors: errors, finishedAt: new Date() }).catch(() => {});
    await logActivity("refresh_finished", `${companyRow.companyName}: refresh failed`, { companyId: companyRow.id, actor: "system", detail: { runId, status: "failed" } });
  }
}
