import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const status = String(b.status);
  if (!["used", "edited", "rejected"].includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });
  const snapshotId = Number(b.snapshotId);
  if (!Number.isInteger(snapshotId)) return Response.json({ error: "Invalid snapshot" }, { status: 400 });
  const [snap] = await getDb().select({ companyId: schema.snapshots.companyId }).from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId));
  const [co] = snap ? await getDb().select({ name: schema.watchlist.companyName }).from(schema.watchlist).where(eq(schema.watchlist.id, snap.companyId)) : [];
  await logActivity("opener_feedback", `Marked ${co?.name ?? "a company"}'s opener as ${status}`, { companyId: snap?.companyId ?? null, detail: { status } });
  await getDb()
    .insert(schema.openerFeedback)
    .values({ snapshotId, status, editedText: status === "edited" ? String(b.editedText ?? "").slice(0, 600) : null });
  return Response.json({ ok: true });
}
