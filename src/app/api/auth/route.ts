import { cookies } from "next/headers";
import { AUTH_COOKIE, authCookieValue, passcodeMatches } from "@/lib/auth";
import { hit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!(await hit(`auth:${ip}`, 15 * 60_000, 20))) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  if (!passcodeMatches(String(body.passcode ?? ""))) return Response.json({ error: "That passcode is not right." }, { status: 401 });
  (await cookies()).set(AUTH_COOKIE, authCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(AUTH_COOKIE);
  return Response.json({ ok: true });
}
