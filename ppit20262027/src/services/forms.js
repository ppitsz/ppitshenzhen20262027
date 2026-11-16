import {
  collection,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  query,
  where,
  arrayUnion,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";


/* =========================
   CREATE FORM (ADMIN)
========================= */
export async function createForm(formData) {
  if (!formData.title || formData.questions.length === 0) {
    throw new Error("Form must have a title and at least one question");
  }

  return await addDoc(collection(db, "forms"), {
    title: formData.title,
    description: formData.description,
    questions: formData.questions,
    headerColor: formData.headerColor || "#7E0C0E",
    coverImage: formData.coverImage || "",
    isActive: formData.isActive !== undefined ? formData.isActive : false,   // ✅ Use passed value
    isClosed: formData.isClosed !== undefined ? formData.isClosed : true,    // ✅ Use passed value
    allowMultiSub: formData.allowMultiSub === true,
    ticket: formData.ticket || null,
    createdBy: formData.createdBy,
    createdAt: serverTimestamp(),
  });
}


/* =========================
   GET FORM BY ID (PUBLIC)
========================= */
export async function getFormById(formId) {
  if (!formId) return null;

  const ref = doc(db, "forms", formId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();

  return {
    id: snap.id,
    title: data.title,
    description: data.description,
    questions: data.questions,
    isActive: data.isActive,
    ticket: data.ticket?.enabled ? { enabled: true } : null,
    createdBy: data.createdBy,
    // CONVERT TIMESTAMP
    createdAt: data.createdAt
      ? data.createdAt.toMillis()
      : null,
  };
}


/* =========================
   SUBMIT RESPONSE (USER)
========================= */
export async function submitResponse(formId, questions, answers) {

  // REQUIRED FIELD VALIDATION
  questions.forEach((q) => {
    const answer = answers[q.id];

    if (q.required) {
      if (!answer) throw new Error(`"${q.label}" is required`);
      if (Array.isArray(answer) && answer.length === 0)
        throw new Error(`"${q.label}" is required`);
      if (typeof answer === "string" && answer.trim() === "")
        throw new Error(`"${q.label}" is required`);
    }
  });

  const userId = localStorage.getItem("user-id");
  if (!userId) throw new Error("User not logged in");

  // 🔹 GET USER DATA FROM FIRESTORE
  const userSnap = await getDoc(doc(db, "users", userId));
  if (!userSnap.exists()) throw new Error("User not found");

  const userData = userSnap.data();
  const userEmail = userData.email || "";

  // 🔹 GET FORM DATA FROM FIRESTORE
  const formSnap = await getDoc(doc(db, "forms", formId));
  if (!formSnap.exists()) throw new Error("Form not found");

  const formData = formSnap.data();
  const formTitle = formData.title || "";
  const allowMultiSub = formData.allowMultiSub === true;

  // 🔹 BLOCK REPEAT SUBMISSIONS unless the form allows them
  if (!allowMultiSub) {
    const submittedForms = userData.submittedForms || [];
    if (submittedForms.includes(formId)) {
      throw new Error("You have already submitted this form");
    }
  }

  // 🔹 SAVE RESPONSE - MODIFIED: Now saving to subcollection
  const docRef = await addDoc(collection(db, "forms", formId, "responses"), {
    answers,
    submittedBy: userId,
    userEmail: userEmail,
    submittedAt: serverTimestamp(),
  });

  // 🔹 UPDATE USER
  await updateUser(userId, {
    submittedFormId: formId,
  });

  return docRef;
}

/* =========================
   LOAD ALL FORMS (SERVERSIDE)
========================= */
export async function getAllForms() {
  const q = query(
    collection(db, "forms"),
    // where("isActive", "==", true)
  );

  const snap = await getDocs(q);

  const formList = snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      title: data.title,
      description: data.description,
      createdBy: data.createdBy,
      createdAt: data.createdAt ? data.createdAt.toMillis() : null,
      coverImage: data.coverImage,
      headerColor: data.headerColor,
      isActive: data.isActive,
      isClosed: data.isClosed,
      allowMultiSub: data.allowMultiSub === true,
      ticket: data.ticket,
    };
  });

  return formList;
}


/* =========================
   LOAD ALL USERS (SERVERSIDE)
 ========================= */
export async function getAllUsers() {
  const q = query(
    collection(db, "users"),
  );

  const snap = await getDocs(q);
  try {
    const userList = snap.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        email: data.email,
        admin: data.admin, //bool
      };
    });
    return userList;
  } catch (e) {
    console.error(e);
    return [];
  }
}

/* =========================
   UPDATE/ADD A USER (SERVERSIDE)
 ========================= */
export async function updateUser(
  uid,
  {
    email = "",
    name = "",
    birthday = "",
    cohortYear = null,
    submittedFormId = null,
  } = {}
) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  // Get current year for default cohort
  const currentYear = new Date().getFullYear();

  // Create user if not exists
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email,
      name: name || email.split('@')[0] || "", // Fallback to email username
      admin: false,
      status: "active",
      graduated: false,
      birthday: birthday || null,
      cohortYear: cohortYear || currentYear - 1,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
      submittedForms: submittedFormId ? [submittedFormId] : [],
      attendedForms: [],
    });
    return;
  }

  // Build update payload
  const updateData = {
    lastLogin: serverTimestamp(),
    status: "active", // Always reactivate on login
  };

  // Only update fields if provided
  if (name) updateData.name = name;
  if (birthday) updateData.birthday = birthday;
  if (cohortYear) updateData.cohortYear = parseInt(cohortYear);
  if (submittedFormId) {
    updateData.submittedForms = arrayUnion(submittedFormId);
  }

  await updateDoc(userRef, updateData);
}

/* ==================
   HELPER FUNCTIONS
================== */
export async function getUserByNameOrEmail(identifier) {
  try {
    const usersRef = collection(db, 'users');

    // Try to find by email first
    let q = query(usersRef, where('email', '==', identifier));
    let querySnapshot = await getDocs(q);

    // If not found by email, try by name
    if (querySnapshot.empty) {
      q = query(usersRef, where('name', '==', identifier));
      querySnapshot = await getDocs(q);
    }

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting user data:', error);
    return null;
  }
}

export async function getUserNameByEmail(email) {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const data = doc.data();
      return data.name || data.displayName || email.split('@')[0];
    }

    // Fallback: return email username if not found
    return email.split('@')[0];
  } catch (error) {
    console.error('Error getting user name:', error);
    return email.split('@')[0];
  }
}

export async function getUserByUid(uid) {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('uid', '==', uid));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting user by UID:', error);
    return null;
  }
}