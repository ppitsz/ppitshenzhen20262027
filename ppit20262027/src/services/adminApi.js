import { auth } from "../lib/firebase";

/*
  fetch() for the admin-only API routes (the email sender): sends the signed-in admin's
  Firebase ID token, which the route checks (lib/email/admin.js).
*/
export async function adminFetch(url, options = {}) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}
