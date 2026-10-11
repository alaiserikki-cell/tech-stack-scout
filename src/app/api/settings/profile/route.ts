import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";

const ProfileZ = z.object({
  product_name: z.string().min(1).max(80),
  one_line_pitch: z.string().min(1).max(400),
  problem_it_solves: z.string().min(1).max(1500),
  ideal_customer_signals: z.array(z.string().max(300)).max(20),
  target_languages: z.array(z.string().max(40)).max(30),
  target_ci_systems: z.array(z.string().max(40)).max(20),
  target_patterns: z.array(z.string().max(60)).max(20),
  competitors_and_adjacent: z.array(z.object({ name: z.string().max(80), detection: z.array(z.string().max(120)).max(20), verify: z.boolean() })).max(20),
  proof_points: z.array(z.string().max(300)).max(10),
});

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => null);
  const r = ProfileZ.safeParse(body);
  if (!r.success) return Response.json({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  await getDb().insert(schema.productProfile).values({ data: r.data });
  await logActivity("profile_saved", `Saved the product profile (${r.data.product_name})`);
  return Response.json({ ok: true });
}
