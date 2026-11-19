import { NextResponse } from "next/server";
import { HttpError, requireAdmin } from "@/lib/tickets/server";

/*
  The email routes send mail as PPIT Shenzhen and read members' emails and birthdays,
  so only website admins may call them: the browser sends its Firebase ID token
  ("Authorization: Bearer <token>", see services/adminApi.js).
  Returns a response to send back when the caller isn't an admin, else null.
*/
export async function adminOnly(req) {
  try {
    await requireAdmin(req);
    return null;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
