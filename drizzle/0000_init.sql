CREATE TABLE "digest_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_id" integer NOT NULL,
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_of" date NOT NULL,
	"ranked_accounts" jsonb NOT NULL,
	"html" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "digests_week_of_unique" UNIQUE("week_of")
);
--> statement-breakpoint
CREATE TABLE "http_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"etag" text,
	"body" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"company_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opener_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"status" text NOT NULL,
	"edited_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "refresh_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"step" text,
	"collector_errors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requirement_level" text,
	"confidence" text,
	"evidence_url" text,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer,
	"computed" jsonb NOT NULL,
	"brief" jsonb,
	"brief_status" text DEFAULT 'pending' NOT NULL,
	"change_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage" text NOT NULL,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"signal_id_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_dictionary" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"category" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"detection_files" jsonb NOT NULL,
	"dependency_names" jsonb NOT NULL,
	"verify" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_state" (
	"company_id" integer NOT NULL,
	"tech" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"missing_runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tech_state_company_id_tech_pk" PRIMARY KEY("company_id","tech")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"domain" text NOT NULL,
	"github_org" text,
	"github_org_verified" boolean DEFAULT false NOT NULL,
	"ats_provider" text,
	"ats_slug" text,
	"ats_verified" boolean DEFAULT false NOT NULL,
	"blog_feed_url" text,
	"blog_verified" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"added_by" text DEFAULT 'nikhil' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	CONSTRAINT "watchlist_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opener_feedback" ADD CONSTRAINT "opener_feedback_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_runs" ADD CONSTRAINT "refresh_runs_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_run_id_refresh_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."refresh_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_run_id_refresh_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."refresh_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_state" ADD CONSTRAINT "tech_state_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_runs_company_idx" ON "refresh_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "signals_run_idx" ON "signals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "signals_company_idx" ON "signals" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "snapshots_company_idx" ON "snapshots" USING btree ("company_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_dictionary_name_idx" ON "tech_dictionary" USING btree ("canonical_name");