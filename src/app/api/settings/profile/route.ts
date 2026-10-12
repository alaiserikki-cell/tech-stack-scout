import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";
import { ProfileZ } from "@/lib/profile-schema";
import { cleanProfile, knownFromDictionary } from "@/lib/profile-validate";
import { loadDictionary } from "@/lib/repo";

const FIELD: Record<string, string> = {
  product_name: "product_name",
  one_line_pitch: "one_line_pitch",
  problem_it_solves: "problem_it_solves",
  target_languages: "target_languages",
  target_ci_systems: "target_ci_systems",
  target_clouds: "target_clouds",
  target_patterns: "target_patterns",
  ideal_customer_signals: "ideal_customer_signals",
};

/** Save the targeting. Shape is checked by ProfileZ, content by cleanProfile (the same rules the form uses). */
export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => null);
  const r = ProfileZ.safeParse(body);
  if (!r.success) {
    const errors: Record<string, string> = {};
    for (const i of r.error.issues) errors[FIELD[String(i.path[0])] ?? "form"] ??= `${i.path.join(".")}: ${i.message}`;
    return Response.json({ error: "Some fields are not valid.", errors }, { status: 400 });
  }
  const clean = cleanProfile(r.data as never, knownFromDictionary(await loadDictionary()));
  if (!clean.ok) return Response.json({ error: "Some fields are not valid.", errors: clean.errors }, { status: 400 });
  await getDb().insert(schema.productProfile).values({ data: clean.profile });
  await logActivity("profile_saved", `Saved the targeting (${clean.profile.product_name})`);
  return Response.json({ ok: true, profile: clean.profile });
}
