import { getAuth } from "firebase-admin/auth";
// Importing it also starts the Admin SDK with this site's service account.
import { adminDb } from "@/lib/tickets/server";

/*
  The bridge to PPITSZ Account (account.ppitshenzhen.org), which signs everyone in.
  It sets the "ppitsz_session" cookie on .ppitshenzhen.org, so this site receives it too.
  These helpers check that cookie, as Account's own apps do, so this site can sign its
  Firebase client in as the same account (see src/services/auth.js and AccountSync).
  The cookie's name and attributes are Account's: keep them matching
  (ppitsz repo, packages/accounts/src/session.ts and docs/adr/0015).
*/

export const SESSION_COOKIE = "ppitsz_session";

/*
  Only this site's own pages may call the bridge: another site must not be able to
  turn a visitor's cookie into a sign-in token.
*/
export function isSameOrigin(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/* Account's checks for a finished profile: the name, birthday and intake year its sign-up asks for. */
function isProfileComplete(data) {
  return (
    typeof data?.name === "string" && data.name.trim().length >= 2 &&
    typeof data.birthday === "string" && data.birthday !== "" &&
    typeof data.cohortYear === "number"
  );
}

/*
  The account signed in on PPITSZ Account, or null when there is no cookie or it is
  expired or revoked. `complete` says whether their profile has everything sign-up asks for.
*/
export async function accountFromCookie(req) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  let uid;
  try {
    uid = (await getAuth().verifySessionCookie(cookie, true)).uid;
  } catch {
    return null;
  }
  const snap = await adminDb().collection("users").doc(uid).get();
  return { uid, complete: isProfileComplete(snap.data()) };
}

/* A token the browser trades for a Firebase sign-in as that account (signInWithCustomToken). */
export function signInToken(uid) {
  return getAuth().createCustomToken(uid);
}

/* The cookie's domain, as Account sets it: .ppitshenzhen.org live, none on localhost. */
export function sessionCookieDomain(req) {
  const host = (req.headers.get("host") || "").split(":")[0];
  return host === "ppitshenzhen.org" || host.endsWith(".ppitshenzhen.org") ? ".ppitshenzhen.org" : undefined;
}
