import { FieldValue } from "firebase-admin/firestore";
// Importing it also starts the Admin SDK with this site's service account.
import { adminDb } from "@/lib/tickets/server";

/*
  Server only (the monthly /api/cron/update-status). Reads every member's record, so it
  uses the Admin SDK: Firestore's rules don't let anyone read them signed out.
  Moved here from services/forms.js, unchanged apart from that.
*/

// A Firestore batch takes at most 500 writes.
const BATCH_SIZE = 400;

/* Marks members inactive after 2 years without a sign-in, graduated after 4, and active again when they return. */
export async function updateUserStatus() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const twoYearsAgo = new Date();
  const fourYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);

  const snapshot = await adminDb().collection("users").get();
  if (snapshot.empty) {
    return { success: true, message: "No users found", updated: 0 };
  }

  const writes = [];
  const updates = [];

  snapshot.forEach((docSnap) => {
    const userData = docSnap.data();
    const lastLogin = userData.lastLogin?.toDate?.() || userData.createdAt?.toDate?.() || new Date(0);

    let needsUpdate = false;
    let newStatus = userData.status || "active";
    let newGraduated = userData.graduated || false;
    const cohortYear = userData.cohortYear || currentYear - 1;

    // Skip users with no date info
    if (lastLogin.getTime() === 0 && !userData.createdAt) return;

    const autoGraduated = lastLogin < fourYearsAgo && cohortYear + 4 <= currentYear;

    if (autoGraduated && !newGraduated) {
      newGraduated = true;
      newStatus = "inactive";
      needsUpdate = true;
      updates.push({
        email: userData.email,
        action: "auto_graduated",
        lastLogin,
        cohortYear,
        reason: `Last login >4 years and cohort ${cohortYear}+4 = ${cohortYear + 4} <= ${currentYear}`,
      });
    }
    // Manually graduated: make sure they are inactive
    else if (userData.graduated === true && newStatus !== "inactive") {
      newStatus = "inactive";
      needsUpdate = true;
      updates.push({ email: userData.email, action: "manual_graduated_verified", lastLogin, cohortYear });
    }
    // 2–4 years without a sign-in, not graduated: inactive
    else if (lastLogin < twoYearsAgo && lastLogin >= fourYearsAgo && !newGraduated) {
      if (newStatus !== "inactive") {
        newStatus = "inactive";
        needsUpdate = true;
        updates.push({ email: userData.email, action: "inactive", lastLogin, cohortYear });
      }
    }
    // Signed in within 2 years: active again
    else if (lastLogin >= twoYearsAgo) {
      if (newStatus !== "active" && !userData.graduated) {
        newStatus = "active";
        newGraduated = false;
        needsUpdate = true;
        updates.push({ email: userData.email, action: "reactivated", lastLogin, cohortYear });
      }
      // Manually graduated but signed in: active, still graduated
      else if (userData.graduated === true) {
        newStatus = "active";
        needsUpdate = true;
        updates.push({ email: userData.email, action: "reactivated_graduate", lastLogin, cohortYear });
      }
    }

    if (needsUpdate) {
      writes.push({
        ref: docSnap.ref,
        data: { status: newStatus, graduated: newGraduated, updatedAt: FieldValue.serverTimestamp() },
      });
    }
  });

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = adminDb().batch();
    for (const { ref, data } of writes.slice(i, i + BATCH_SIZE)) batch.update(ref, data);
    await batch.commit();
  }

  return {
    success: true,
    message: `Updated ${writes.length} users`,
    updated: writes.length,
    details: updates,
  };
}
