import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,

  date,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const productProfile = pgTable("product_profile", {
  id: serial("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const techDictionary = pgTable(
  "tech_dictionary",
  {
    id: serial("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    category: text("category").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull(),
    detectionFiles: jsonb("detection_files").$type<string[]>().notNull(),
    dependencyNames: jsonb("dependency_names").$type<string[]>().notNull(),
    verify: boolean("verify").notNull().default(false),
  },
  (t) => [uniqueIndex("tech_dictionary_name_idx").on(t.canonicalName)],
);

export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  domain: text("domain").notNull().unique(),
  githubOrg: text("github_org"),
  githubOrgVerified: boolean("github_org_verified").notNull().default(false),
  atsProvider: text("ats_provider"), // greenhouse | lever | ashby | none
  atsSlug: text("ats_slug"),
  atsVerified: boolean("ats_verified").notNull().default(false),
  blogFeedUrl: text("blog_feed_url"),
  blogVerified: boolean("blog_verified").notNull().default(false),
  active: boolean("active").notNull().default(true),
  addedBy: text("added_by").notNull().default("nikhil"), // nikhil | demo
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
});

export const refreshRuns = pgTable(
  "refresh_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // cron | manual | on_add
    status: text("status").notNull().default("queued"), // queued|running|success|partial|failed|skipped_unchanged
    step: text("step"),
    collectorErrors: jsonb("collector_errors").$type<Record<string, string>>().default({}).notNull(),
    inputHash: text("input_hash"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("refresh_runs_company_idx").on(t.companyId, t.startedAt)],
);

export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    runId: integer("run_id")
      .notNull()
      .references(() => refreshRuns.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // github | jobs | blog | hn | hosting
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    requirementLevel: text("requirement_level"),
    confidence: text("confidence"),
    evidenceUrl: text("evidence_url"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("signals_run_idx").on(t.runId), index("signals_company_idx").on(t.companyId)],
);

export const techState = pgTable(
  "tech_state",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    tech: text("tech").notNull(),
    status: text("status").notNull().default("active"), // active | dropped
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    missingRuns: integer("missing_runs").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.tech] })],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => refreshRuns.id, { onDelete: "set null" }),
    computed: jsonb("computed").notNull(),
    brief: jsonb("brief"),
    briefStatus: text("brief_status").notNull().default("pending"), // ok | pending | failed | none
    changeEvents: jsonb("change_events").notNull().default([]),
    coverage: text("coverage").notNull(),
    fitScore: integer("fit_score").notNull().default(0),
    signalIdMap: jsonb("signal_id_map").notNull().default([]),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("snapshots_company_idx").on(t.companyId, t.generatedAt)],
);

export const digests = pgTable("digests", {
  id: serial("id").primaryKey(),
  weekOf: date("week_of").notNull().unique(),
  rankedAccounts: jsonb("ranked_accounts").notNull(),
  html: text("html").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  emailStatus: text("email_status").notNull().default("pending"),
});

export const digestSends = pgTable("digest_sends", {
  id: serial("id").primaryKey(),
  digestId: integer("digest_id")
    .notNull()
    .references(() => digests.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(), // stored as sha256 hash, never displayed
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").notNull(),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  task: text("task").notNull(), // brief | blog_extract
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  status: text("status").notNull().default("ok"), // ok | invalid | error | quota | skipped_unchanged
  companyId: integer("company_id").references(() => watchlist.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const openerFeedback = pgTable("opener_feedback", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => snapshots.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // used | edited | rejected
  editedText: text("edited_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const httpCache = pgTable("http_cache", {
  url: text("url").primaryKey(),
  etag: text("etag"),
  body: jsonb("body"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Company = typeof watchlist.$inferSelect;
export type Run = typeof refreshRuns.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;

/** One row per user or system action (add, remove, refresh, confirm, feedback, digest, settings, cron). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull().default("visitor"), // visitor | system | cron
    companyId: integer("company_id").references(() => watchlist.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => [index("activity_log_at_idx").on(t.at)],
);
