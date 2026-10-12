import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";
import { ProfileZ } from "@/lib/profile-schema";

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => null);
  const r = ProfileZ.safeParse(body);
  if (!r.success) return Response.json({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  await getDb().insert(schema.productProfile).values({ data: r.data });
  await logActivity("profile_saved", `Saved the product profile (${r.data.product_name})`);
  return Response.json({ ok: true });
}
