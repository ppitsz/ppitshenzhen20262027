"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { accountSignInUrl, handoff, safePath } from "@/services/auth";

/*
  Signing in happens on PPITSZ Account. This page picks the sign-in up when someone is already
  signed in there, or sends them there and back (?from=account), then on to ?next=.
  New accounts give their name, birthday and intake year on Account, not here.
*/
export default function LoginPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [next, setNext] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = safePath(params.get("next"));
    const fromAccount = params.get("from") === "account";
    setNext(target);

    handoff()
      .then((result) => {
        if (result === "signed-in") router.replace(target);
        // Back from Account but still not signed in: ask, rather than sending them round again.
        else if (fromAccount) setFailed(true);
        else window.location.assign(accountSignInUrl(target));
      })
      .catch((err) => {
        console.error("Login failed", err);
        setFailed(true);
      });
  }, [router]);

  if (!failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#7E0C0E]">
        <div className="text-white text-xl">Signing you in...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center font-montserrat justify-center bg-[#7E0C0E] px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Log In</h1>
        <p className="text-gray-800 mb-8">
          We couldn&apos;t sign you in. Sign in with your PPITSZ Account to register for PPITSZ&apos;s events.
        </p>
        <button
          onClick={() => window.location.assign(accountSignInUrl(next))}
          className="w-full flex items-center justify-center gap-3 border border-gray-600 py-3 font-semibold text-gray-800 hover:bg-gray-100 transition"
        >
          Continue to PPITSZ Account
        </button>
      </div>
    </div>
  );
}
