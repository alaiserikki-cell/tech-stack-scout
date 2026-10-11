import type { Collector, CollectorContext, CollectorResult } from "@/lib/types";
import { withTimeout } from "@/lib/http";
import { githubCollector } from "./github";
import { jobsCollector } from "./jobs";
import { blogCollector } from "./blog";
import { hnCollector } from "./hn";
import { hostingCollector } from "./hosting";

/** Registry. Add a new source (e.g. TheirStack, YouTube) by writing a file that exports a Collector and listing it here. */
export const COLLECTORS: Collector[] = [githubCollector, jobsCollector, blogCollector, hnCollector, hostingCollector];

export interface CollectorOutcome extends CollectorResult {
  name: string;
  error: string | null;
  ms: number;
}

/** Run one collector with its own timeout and error capture. A failing collector never fails the refresh. */
export async function runCollector(c: Collector, ctx: CollectorContext): Promise<CollectorOutcome> {
  const t0 = Date.now();
  try {
    const r = await withTimeout(c.collect(ctx), c.timeoutMs, c.name);
    return { ...r, name: c.name, error: null, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: c.name, signals: [], checked: [], error: msg.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").slice(0, 300), ms: Date.now() - t0 };
  }
}
