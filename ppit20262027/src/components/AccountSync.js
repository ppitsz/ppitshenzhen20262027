"use client";

import { useEffect } from "react";
import { auth } from "../lib/firebase";
import { accountSession, handoff, signOutHere } from "../services/auth";

/*
  Keeps this site's Firebase sign-in in step with PPITSZ Account, once per page load:
  signed in on Account (say, in the shop) signs in here too; signed out there (or a
  password reset) signs out here. /login does its own handoff, so this skips it.
*/
export default function AccountSync() {
  useEffect(() => {
    if (window.location.pathname === "/login") return;
    let cancelled = false;

    (async () => {
      try {
        await auth.authStateReady();
        const account = await accountSession();
        if (cancelled) return;
        const current = auth.currentUser;
        if (!account.uid) {
          if (current) await signOutHere();
        } else if (account.complete) {
          if (current?.uid !== account.uid) await handoff(account);
        } else if (current && current.uid !== account.uid) {
          // Someone else is signed in on Account, and still has details to fill in there.
          await signOutHere();
        }
      } catch (err) {
        console.error("Checking the PPITSZ Account sign-in failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
