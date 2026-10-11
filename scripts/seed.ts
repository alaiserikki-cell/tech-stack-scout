// Loads product profile, tech dictionary and seed companies into Neon.
// Usage: npx tsx scripts/seed.ts            (profile + dictionary + companies from data/seed-companies.json)
//        npx tsx scripts/seed.ts --no-companies
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import type { DictEntry } from "../src/lib/types";

async function main() {
  const db = getDb();
  const profile = JSON.parse(readFileSync("data/product-profile.json", "utf8"));
  const existing = await db.select({ id: schema.productProfile.id }).from(schema.productProfile).limit(1);
  if (!existing.length) {
    await db.insert(schema.productProfile).values({ data: profile });
    console.log("product_profile: inserted");
  } else console.log("product_profile: exists (edit it in /settings)");

  const dict: DictEntry[] = JSON.parse(readFileSync("data/tech-dictionary.json", "utf8"));
  for (let i = 0; i < dict.length; i += 50) {
    await db
      .insert(schema.techDictionary)
      .values(
        dict.slice(i, i + 50).map((d) => ({
          canonicalName: d.canonical_name,
          category: d.category,
          aliases: d.aliases,
          detectionFiles: d.detection_files,
          dependencyNames: d.dependency_names,
          verify: d.verify,
        })),
      )
      .onConflictDoUpdate({
        target: schema.techDictionary.canonicalName,
        // keep a verify flag that was cleared in /settings
        set: {
          category: sql`excluded.category`,
          aliases: sql`excluded.aliases`,
          detectionFiles: sql`excluded.detection_files`,
          dependencyNames: sql`excluded.dependency_names`,
          verify: sql`tech_dictionary.verify AND excluded.verify`,
        },
      });
  }
  console.log(`tech_dictionary: upserted ${dict.length}`);

  if (!process.argv.includes("--no-companies") && existsSync("data/seed-companies.json")) {
    const companies = JSON.parse(readFileSync("data/seed-companies.json", "utf8")) as {
      company_name: string;
      domain: string;
      github_org: string | null;
      ats_provider: string | null;
      ats_slug: string | null;
      blog_feed_url: string | null;
    }[];
    for (const c of companies) {
      await db
        .insert(schema.watchlist)
        .values({
          companyName: c.company_name,
          domain: c.domain,
          githubOrg: c.github_org,
          githubOrgVerified: Boolean(c.github_org),
          atsProvider: c.ats_provider,
          atsSlug: c.ats_slug,
          atsVerified: Boolean(c.ats_provider),
          blogFeedUrl: c.blog_feed_url,
          blogVerified: Boolean(c.blog_feed_url),
          addedBy: "nikhil",
        })
        .onConflictDoNothing({ target: schema.watchlist.domain });
    }
    console.log(`watchlist: ${companies.length} seed companies ensured`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
