import { signInWithCustomToken, signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

/*
  Signing in happens on PPITSZ Account (account.ppitshenzhen.org), for this site and every
  PPITSZ app. This site then signs its Firebase client in as the same account, so every page
  that waits for onAuthStateChanged, and form submission's localStorage "user-id", work as
  they did with the old Google pop-up. See src/lib/account/server.js.
*/

function accountOrigin() {
  if (process.env.NEXT_PUBLIC_ACCOUNT_ORIGIN) return process.env.NEXT_PUBLIC_ACCOUNT_ORIGIN;
  // Locally, PPITSZ Account runs on port 3003 (ppitsz repo, `bun run dev`).
  return window.location.hostname === "localhost" ? "http://localhost:3003" : "https://account.ppitshenzhen.org";
}

/* A path on this site, or "/": a crafted ?next= must not lead anywhere else. */
export function safePath(next) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

/* /login, coming back to the page we're on. For pages that need someone signed in. */
export function loginPath() {
  return `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/* PPITSZ Account's sign-in, coming back to this site's /login and then to `next`. */
export function accountSignInUrl(next) {
  const back = `${window.location.origin}/login?from=account&next=${encodeURIComponent(safePath(next))}`;
  return `${accountOrigin()}/sign-in?next=${encodeURIComponent(back)}`;
}

/* Who is signed in on PPITSZ Account: { uid: null }, { uid, complete: false } or { uid, complete: true, token }. */
export async function accountSession() {
  const res = await fetch("/api/account/session", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`Sign-in check failed (${res.status})`);
  return res.json();
}

/*
  Signs the Firebase client in as the account signed in on PPITSZ Account.
  Returns "signed-in", "incomplete" (their profile still needs details) or "signed-out".
*/
export async function handoff(session) {
  const account = session ?? (await accountSession());
  if (!account.uid) return "signed-out";
  if (!account.complete) return "incomplete";
  if (auth.currentUser?.uid !== account.uid) await signInWithCustomToken(auth, account.token);
  localStorage.setItem("user-id", account.uid);
  return "signed-in";
}

/* Signs the Firebase client out, here only. */
export async function signOutHere() {
  await signOut(auth);
  localStorage.removeItem("user-id");
}

/* Signs out of this site and every PPITSZ app, as signing out on any of them does. */
export async function signOutEverywhere() {
  try {
    await fetch("/api/account/sign-out", { method: "POST", credentials: "same-origin" });
  } catch (err) {
    console.error("Signing out of PPITSZ Account failed", err);
  }
  await signOutHere();
}
