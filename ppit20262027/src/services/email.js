import { FieldValue, Timestamp } from 'firebase-admin/firestore';
// Importing it also starts the Admin SDK with this site's service account.
import { adminDb } from '@/lib/tickets/server';
import { deliverEmail } from '@/lib/email/deliver';

/*
  Server only: the email API routes and crons use this, never the browser.
  It reads members' emails and birthdays, so it uses the Admin SDK: Firestore's rules
  don't let anyone read those signed out.
*/

const EMAIL_SENDS_COLLECTION = 'emailSends';
const BIRTHDAY_TEMPLATES_COLLECTION = 'birthdayTemplates';
const USERS_COLLECTION = 'users';

const db = () => adminDb();

// Timestamps go to the browser as { seconds, nanoseconds }, which EmailList reads.
function plain(data) {
    const out = { ...data };
    for (const [key, value] of Object.entries(out)) {
        if (value instanceof Timestamp) out[key] = { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    return out;
}

// ============================================================
// EMAIL CRUD OPERATIONS
// ============================================================

export async function createEmailSend(emailData) {
    try {
        let scheduledTime = emailData.scheduledTime;

        if (scheduledTime && typeof scheduledTime === 'object' && scheduledTime.seconds !== undefined) {
            // Convert serialized Map to Timestamp
            scheduledTime = new Timestamp(scheduledTime.seconds, scheduledTime.nanoseconds || 0);
        } else if (scheduledTime instanceof Date) {
            scheduledTime = Timestamp.fromDate(scheduledTime);
        } else if (typeof scheduledTime === 'string') {
            scheduledTime = Timestamp.fromDate(new Date(scheduledTime));
        }

        const docRef = await db().collection(EMAIL_SENDS_COLLECTION).add({
            ...emailData,
            scheduledTime: scheduledTime || null,
            status: scheduledTime ? 'scheduled' : 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return { id: docRef.id, ...emailData };
    } catch (error) {
        console.error('Error creating email send:', error);
        throw error;
    }
}

// `lastDoc` is the id of the last email on the previous page.
export async function getEmailSends(lastDoc = null, limitCount = 10) {
    try {
        let q = db().collection(EMAIL_SENDS_COLLECTION).orderBy('createdAt', 'desc');
        if (lastDoc) {
            const last = await db().collection(EMAIL_SENDS_COLLECTION).doc(lastDoc).get();
            if (last.exists) q = q.startAfter(last);
        }
        const snapshot = await q.limit(limitCount).get();
        const emails = snapshot.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
        return { emails, lastVisible: snapshot.docs.at(-1)?.id ?? null };
    } catch (error) {
        console.error('Error fetching email sends:', error);
        throw error;
    }
}

export async function updateEmailStatus(emailId, status, error = null) {
    try {
        await db().collection(EMAIL_SENDS_COLLECTION).doc(emailId).update({
            status,
            sentAt: status === 'sent' ? FieldValue.serverTimestamp() : null,
            error: error || null,
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (error) {
        console.error('Error updating email status:', error);
        throw error;
    }
}

export async function getScheduledEmails(currentTime) {
    try {
        const timestamp = Timestamp.fromDate(currentTime);
        console.log(`Querying for scheduled emails <= ${timestamp.seconds} (${currentTime.toISOString()})`);

        const snapshot = await db()
            .collection(EMAIL_SENDS_COLLECTION)
            .where('status', '==', 'scheduled')
            .where('scheduledTime', '<=', timestamp)
            .get();

        console.log(`Found ${snapshot.size} scheduled emails due`);
        return snapshot.docs.map((d) => {
            const data = d.data();
            const scheduledTime = data.scheduledTime?.toDate?.() || new Date(data.scheduledTime);
            return { id: d.id, ...data, scheduledTime };
        });
    } catch (error) {
        console.error('Error fetching scheduled emails:', error);
        return [];
    }
}

// ============================================================
// RECIPIENT FUNCTIONS
// ============================================================

export async function getAllRecipients(cohort = null) {
    try {
        let q = db()
            .collection(USERS_COLLECTION)
            .where('status', '==', 'active')
            .where('graduated', '==', false);
        if (cohort) q = q.where('cohortYear', '==', parseInt(cohort));

        const snapshot = await q.get();
        return snapshot.docs.map((d) => {
            const data = d.data();
            return {
                id: d.id,
                email: data.email,
                name: data.name || data.displayName || '',
                cohortYear: data.cohortYear || null,
                birthday: data.birthday || null,
            };
        });
    } catch (error) {
        console.error('Error fetching recipients:', error);
        return [];
    }
}

export async function getBirthdayRecipients() {
    try {
        const snapshot = await db()
            .collection(USERS_COLLECTION)
            .where('status', '==', 'active')
            .where('graduated', '==', false)
            .get();

        const today = new Date();
        const todayStr = `${today.getMonth() + 1}-${today.getDate()}`;
        const recipients = [];

        snapshot.forEach((d) => {
            const data = d.data();
            if (data.birthday) {
                const bday = new Date(data.birthday);
                const bdayStr = `${bday.getMonth() + 1}-${bday.getDate()}`;
                if (bdayStr === todayStr) {
                    recipients.push({
                        id: d.id,
                        email: data.email,
                        name: data.name || data.displayName || '',
                        birthday: data.birthday,
                    });
                }
            }
        });

        return recipients;
    } catch (error) {
        console.error('Error fetching birthday recipients:', error);
        return [];
    }
}

// ============================================================
// BIRTHDAY TEMPLATE FUNCTIONS
// ============================================================

export async function getBirthdayTemplates() {
    try {
        const snapshot = await db().collection(BIRTHDAY_TEMPLATES_COLLECTION).orderBy('createdAt', 'desc').get();
        return snapshot.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
    } catch (error) {
        console.error('Error fetching birthday templates:', error);
        return [];
    }
}

export async function getActiveBirthdayTemplate() {
    try {
        const snapshot = await db().collection(BIRTHDAY_TEMPLATES_COLLECTION).where('isActive', '==', true).limit(1).get();
        if (snapshot.empty) return null;
        const d = snapshot.docs[0];
        return { id: d.id, ...d.data() };
    } catch (error) {
        console.error('Error getting active birthday template:', error);
        return null;
    }
}

export async function saveBirthdayTemplate(templateData) {
    try {
        const { id, ...fields } = templateData;
        // Timestamps come back from the browser as plain objects: keep the stored ones.
        delete fields.createdAt;
        delete fields.updatedAt;
        if (id) {
            await db().collection(BIRTHDAY_TEMPLATES_COLLECTION).doc(id).update({
                ...fields,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { id, ...fields };
        }
        const docRef = await db().collection(BIRTHDAY_TEMPLATES_COLLECTION).add({
            ...fields,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return { id: docRef.id, ...fields };
    } catch (error) {
        console.error('Error saving birthday template:', error);
        throw error;
    }
}

// ============================================================
// SEND EMAILS (NO PERSONALIZATION FOR BROADCAST)
// ============================================================

export async function sendEmails(recipients, content, emailId, type = 'broadcast', individually = false, attachmentFiles = []) {
    try {
        await updateEmailStatus(emailId, 'sending');

        const result = await deliverEmail({
            to: recipients,
            subject: content.subject || 'Broadcast Email',
            html: content.html || content.text?.replace(/\n/g, '<br>') || '',
            text: content.text || '',
            attachmentFiles,
            isIndividual: individually,
        });

        await updateEmailStatus(
            emailId,
            result.sent > 0 ? 'sent' : 'failed',
            result.failed > 0 ? `${result.failed} recipients failed` : null
        );
        return result;
    } catch (error) {
        console.error('Error sending emails:', error);
        await updateEmailStatus(emailId, 'failed', error.message);
        throw error;
    }
}

// ============================================================
// BIRTHDAY PROCESSING (ONLY PERSONALIZATION HERE)
// ============================================================

export async function processBirthdayEmails() {
    try {
        const today = new Date();
        const todayStr = `${today.getMonth() + 1}-${today.getDate()}`;

        console.log(`🎂 Checking birthdays for ${todayStr}...`);

        const birthdayPeople = await getBirthdayRecipients();

        if (birthdayPeople.length === 0) {
            console.log('No birthdays today');
            return { sent: 0, message: 'No birthdays today' };
        }

        console.log(`🎂 Found ${birthdayPeople.length} birthdays today`);

        const activeTemplate = await getActiveBirthdayTemplate();

        if (!activeTemplate) {
            console.log('No active birthday template found');
            return { sent: 0, message: 'No active birthday template' };
        }

        let sentCount = 0;
        for (const person of birthdayPeople) {
            try {
                const name = person.name || person.email.split('@')[0];

                const personalizedContent = {
                    subject: activeTemplate.subject.replace(/{name}/g, name),
                    text: activeTemplate.text.replace(/{name}/g, name),
                    html: activeTemplate.html?.replace(/{name}/g, name),
                };

                const result = await createEmailSend({
                    recipients: [person.email],
                    content: personalizedContent,
                    type: 'birthday',
                    status: 'pending',
                    scheduledTime: null,
                    sendNow: true,
                    sendIndividually: false,
                    useHTML: true,
                    recipientInfo: person,
                });
                await sendEmails([person.email], personalizedContent, result.id, 'birthday', false);
                sentCount++;
                console.log(`✅ Sent birthday email to ${name} (${person.email})`);
            } catch (error) {
                console.error(`❌ Error sending birthday email to ${person.email}:`, error);
            }
        }

        return {
            sent: sentCount,
            total: birthdayPeople.length,
            message: `Sent ${sentCount} birthday emails out of ${birthdayPeople.length}`
        };
    } catch (error) {
        console.error('Error processing birthday emails:', error);
        throw error;
    }
}

// ============================================================
// SCHEDULED EMAIL PROCESSING
// ============================================================
export async function processScheduledEmails() {
    try {
        const now = new Date();
        console.log(`Checking scheduled emails at ${now.toISOString()}`);

        const scheduledEmails = await getScheduledEmails(now);

        let processed = 0;
        for (const email of scheduledEmails) {
            try {
                console.log(`Sending: ${email.content?.subject} (${email.recipients?.length || 0} recipients)`);
                await sendEmails(
                    email.recipients,
                    email.content,
                    email.id,
                    email.type || 'broadcast',
                    email.sendIndividually || false,
                    email.attachmentFiles || []
                );
                processed++;
                console.log(`✅ Sent email ${email.id}`);
            } catch (error) {
                console.error(`❌ Failed to send email ${email.id}:`, error);
            }
        }

        console.log(`Processed ${processed} scheduled emails`);
        return { processed };
    } catch (error) {
        console.error('Error processing scheduled emails:', error);
        throw error;
    }
}

// ============================================================
// WRAPS EMAIL IN PROPER VIEWPORT
// ============================================================
export function getEmailWrapper(content) {
    // Helper function to check if content is HTML
    const isHtml = (str) => {
        if (!str) return false;
        // Check for HTML tags
        return /<[a-z][\s\S]*>/i.test(str);
    };

    let cleanContent = content;

    // Only clean if it's NOT HTML (plain text)
    if (!isHtml(content) && content) {
        cleanContent = content
            // Remove extra line breaks (3+ becomes 2)
            .replace(/\n{3,}/g, '\n\n')
            // Remove extra spaces (2+ becomes 1)
            .replace(/[ ]{2,}/g, ' ')
            // Remove tabs
            .replace(/\t/g, '')
            // Remove spaces at start of lines
            .replace(/^[ ]+/gm, '')
            // Remove trailing spaces
            .replace(/[ ]+$/gm, '')
            .trim();
    }

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    
    .email-container {
      max-width: 600px;
      width: 100%;
      margin: 0 auto;
      padding: 20px 15px;
      background-color: #ffffff;
    }
    
    .email-container .content-wrapper {
      word-wrap: break-word !important;
    }
    
    .email-container h1 {
      margin: 0 0 15px 0 !important;
      font-size: 24px !important;
    }
    
    .email-container h2 {
      margin: 0 0 12px 0 !important;
      font-size: 20px !important;
    }
    
    .email-container h3 {
      margin: 0 0 10px 0 !important;
      font-size: 18px !important;
    }
    
    .email-container p {
      margin: 0 0 12px 0 !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
    }
    
    .email-container ul {
      margin: 8px 0 12px 20px !important;
      padding: 0 !important;
    }
    
    .email-container li {
      margin: 0 0 6px 0 !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
    }
    
    /* Preserve line breaks for non-HTML content */
    .email-container .text-content {
      white-space: pre-wrap !important;
    }
    
    @media only screen and (max-width: 480px) {
      .email-container {
        padding: 15px 10px !important;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="content-wrapper">
      ${isHtml(cleanContent)
            ? cleanContent
            : `<div class="text-content">${cleanContent}</div>`
        }
    </div>
  </div>
</body>
</html>
  `;
}