import nodemailer from "nodemailer";

/*
  Sends one email through PPIT Shenzhen's Gmail (GMAIL_USER / GMAIL_APP_PASSWORD), server only.
  Moved out of /api/emails/send so the email service and the crons call it directly,
  instead of POSTing to our own API.

  Not individually: recipients go in BCC, in batches of 80, 10 seconds apart.
  Individually: one email per recipient, 3 seconds apart.
  Each email is tried up to 3 times.
*/

const MAX_RECIPIENTS_PER_EMAIL = 80;
const DELAY_BETWEEN_BATCHES = 10000;
const DELAY_BETWEEN_INDIVIDUAL = 3000;
const RATE_LIMIT_WAIT = 30000;
const MAX_RETRIES = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadAttachments(attachmentFiles = []) {
    const attachments = [];
    for (const file of attachmentFiles) {
        try {
            const response = await fetch(file.cloudinaryUrl || file.url);
            if (!response.ok) throw new Error(`Failed to download ${file.name}`);
            const buffer = await response.arrayBuffer();
            attachments.push({
                filename: file.name,
                content: Buffer.from(buffer),
                contentType: file.type || "application/octet-stream",
            });
        } catch (error) {
            console.error(`Failed to download ${file.name}:`, error);
        }
    }
    return attachments;
}

/*
  Returns { sent, failed, message, details } — `sent` and `failed` count recipients.
  Throws only when there is nobody to send to.
*/
export async function deliverEmail({ to, subject, html, text, attachmentFiles = [], isIndividual = false }) {
    if (!to || to.length === 0) throw new Error("No recipients specified");

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
        pool: true,
        maxConnections: 1,
        maxMessages: Infinity,
        rateLimit: true,
    });

    const attachments = await downloadAttachments(attachmentFiles);
    const body = {
        subject: subject || "Broadcast Email",
        text: text || "",
        html: html || text?.replace(/\n/g, "<br>") || "",
        attachments,
    };

    const sendWithRetry = async (mailOptions, context) => {
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const info = await transporter.sendMail(mailOptions);
                return { success: true, info };
            } catch (error) {
                lastError = error;
                console.log(`⚠️ Attempt ${attempt}/${MAX_RETRIES} failed for ${context}:`, error.message);
                if (error.message?.includes("Too many login attempts")) {
                    console.log(`⏳ Rate limit hit, waiting ${RATE_LIMIT_WAIT / 1000} seconds before retry...`);
                    await wait(RATE_LIMIT_WAIT);
                } else if (attempt < MAX_RETRIES) {
                    await wait(attempt * 2000);
                }
            }
        }
        return { success: false, error: lastError };
    };

    try {
        if (!isIndividual) {
            const batches = [];
            for (let i = 0; i < to.length; i += MAX_RECIPIENTS_PER_EMAIL) {
                batches.push(to.slice(i, i + MAX_RECIPIENTS_PER_EMAIL));
            }
            console.log(`📧 Sending ${to.length} recipients in ${batches.length} batches (max ${MAX_RECIPIENTS_PER_EMAIL} per batch)`);

            let sent = 0;
            const failedBatches = [];
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const result = await sendWithRetry(
                    { from: `"PPIT Shenzhen" <${process.env.GMAIL_USER}>`, to: process.env.GMAIL_USER, bcc: batch, ...body },
                    `batch ${i + 1}`
                );
                if (result.success) {
                    sent += batch.length;
                    console.log(`✅ Batch ${i + 1}/${batches.length}: sent to ${batch.length} recipients (BCC)`);
                } else {
                    console.error(`❌ Batch ${i + 1}/${batches.length} failed: ${result.error?.message || "Unknown error"}`);
                    failedBatches.push({ batchNumber: i + 1, count: batch.length, error: result.error?.message });
                }
                if (i < batches.length - 1) await wait(DELAY_BETWEEN_BATCHES);
            }

            const failed = failedBatches.reduce((sum, b) => sum + b.count, 0);
            return {
                sent,
                failed,
                message: `Sent to ${sent} recipients in ${batches.length} batches (BCC)`,
                details: failedBatches,
            };
        }

        const details = [];
        for (let i = 0; i < to.length; i++) {
            const recipient = to[i];
            const result = await sendWithRetry(
                { from: `"PPIT Shenzhen" <${process.env.GMAIL_USER}>`, to: recipient, ...body },
                recipient
            );
            if (result.success) {
                details.push({ recipient, success: true, messageId: result.info.messageId });
            } else {
                console.error(`❌ Failed to send to ${recipient}: ${result.error?.message || "Unknown error"}`);
                details.push({ recipient, success: false, error: result.error?.message });
            }
            if (i < to.length - 1) await wait(DELAY_BETWEEN_INDIVIDUAL);
        }

        const sent = details.filter((d) => d.success).length;
        return {
            sent,
            failed: details.length - sent,
            message: `Sent to ${sent} recipients individually`,
            details,
        };
    } finally {
        transporter.close();
    }
}
