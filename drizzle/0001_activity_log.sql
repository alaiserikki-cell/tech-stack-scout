CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"actor" text DEFAULT 'visitor' NOT NULL,
	"company_id" integer,
	"summary" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_watchlist_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."watchlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");