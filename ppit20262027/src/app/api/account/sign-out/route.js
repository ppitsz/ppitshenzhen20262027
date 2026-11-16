import { NextResponse } from "next/server";
import { SESSION_COOKIE, isSameOrigin, sessionCookieDomain } from "@/lib/account/server";

/*
  POST, from this site's own pages only.
  Clears PPITSZ Account's cookie, which signs this browser out of every PPITSZ app,
  as signing out on any of them does. The page signs its Firebase client out itself.
*/
export async function POST(req) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const res = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const domain = sessionCookieDomain(req);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(domain ? { domain } : {}),
  });
  return res;
}
