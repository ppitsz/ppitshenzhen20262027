import { NextResponse } from "next/server";
import { accountFromCookie, isSameOrigin, signInToken } from "@/lib/account/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/*
  POST, from this site's own pages only.
  Who is signed in on PPITSZ Account:
    { uid: null }                           nobody
    { uid, complete: false }                someone whose profile still needs a birthday or intake year
    { uid, complete: true, token }          someone to sign the Firebase client in as (signInWithCustomToken)
*/
export async function POST(req) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403, headers: NO_STORE });
  }
  try {
    const account = await accountFromCookie(req);
    if (!account) return NextResponse.json({ uid: null }, { headers: NO_STORE });
    if (!account.complete) return NextResponse.json({ uid: account.uid, complete: false }, { headers: NO_STORE });
    const token = await signInToken(account.uid);
    return NextResponse.json({ uid: account.uid, complete: true, token }, { headers: NO_STORE });
  } catch (err) {
    console.error("[account/session]", err);
    return NextResponse.json({ error: "Could not check your sign-in." }, { status: 500, headers: NO_STORE });
  }
}
