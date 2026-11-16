import { NextResponse } from 'next/server';
import {
    getEmailSends,
    getAllRecipients,
    getBirthdayRecipients,
    getBirthdayTemplates,
    saveBirthdayTemplate,
    createEmailSend,
    sendEmails,
    getEmailWrapper
} from '../../../services/email';
import { adminOnly } from '@/lib/email/admin';

// Sending to many people individually waits 3 seconds between emails.
export const maxDuration = 300;

// ============================================================
// GET /api/emails  (website admins only)
// Query params:
//   - type=recipients&cohort=2026  → Get recipients (optionally filtered by cohort)
//   - type=birthday-recipients    → Get today's birthdays
//   - type=birthday-templates     → Get birthday templates
//   - lastDoc=<id>&limit=10        → Paginated email sends
// ============================================================
export async function GET(request) {
    const denied = await adminOnly(request);
    if (denied) return denied;

    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');
        const lastDoc = searchParams.get('lastDoc');
        const cohort = searchParams.get('cohort');
        const limit = parseInt(searchParams.get('limit') || '10');

        if (type === 'recipients') {
            const recipients = await getAllRecipients(cohort);
            return NextResponse.json({ success: true, recipients });
        }

        if (type === 'birthday-recipients') {
            const recipients = await getBirthdayRecipients();
            return NextResponse.json({ success: true, recipients });
        }

        if (type === 'birthday-templates') {
            const templates = await getBirthdayTemplates();
            return NextResponse.json({ success: true, templates });
        }

        const result = await getEmailSends(lastDoc, limit);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('GET /api/emails error:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// ============================================================
// POST /api/emails  (website admins only)
// Body, to send or schedule an email:
//   - recipients: string[]
//   - content: { subject, text, html, attachments }
//   - scheduledTime: string | null
//   - sendNow: boolean
//   - sendIndividually: boolean
//   - attachmentFiles: { name, cloudinaryUrl, type }[] (already uploaded)
// Or, to save a birthday template: { type: 'template', templateData }
// ============================================================
export async function POST(request) {
    const denied = await adminOnly(request);
    if (denied) return denied;

    try {
        const body = await request.json();

        if (body.type === 'template') {
            const data = await saveBirthdayTemplate(body.templateData || {});
            return NextResponse.json({ success: true, data, message: 'Template saved successfully' });
        }

        const {
            recipients,
            content,
            scheduledTime,
            sendNow,
            sendIndividually = false,
            attachmentFiles = [],
        } = body;

        if (!recipients || recipients.length === 0) {
            return NextResponse.json(
                { success: false, error: 'At least one recipient is required' },
                { status: 400 }
            );
        }

        if (!content || (!content.text && !content.html)) {
            return NextResponse.json(
                { success: false, error: 'Email content is required' },
                { status: 400 }
            );
        }

        // The attachmentFiles are passed from the client with Cloudinary URLs
        const attachments = attachmentFiles.map(file => ({
            name: file.name,
            size: file.size || 0,
            type: file.type || 'application/octet-stream',
            cloudinaryUrl: file.cloudinaryUrl,
            publicId: file.publicId || null,
        }));

        const emailContent = {
            subject: content.subject || 'Broadcast Email',
            text: content.text,
            html: getEmailWrapper(content.html || content.text || ''),
            attachments,
        };

        const result = await createEmailSend({
            recipients,
            content: emailContent,
            scheduledTime: scheduledTime || null,
            status: 'pending',
            sendNow: sendNow || false,
            sendIndividually,
            type: 'broadcast',
            attachmentFiles: attachments,
        });

        if (sendNow) {
            await sendEmails(recipients, emailContent, result.id, 'broadcast', sendIndividually, attachments);
        }

        const message = sendNow
            ? (sendIndividually
                ? `${recipients.length} emails sent individually`
                : 'Email sent successfully')
            : (sendIndividually
                ? `${recipients.length} emails scheduled individually`
                : 'Email scheduled successfully');

        return NextResponse.json({
            success: true,
            data: result,
            message,
            attachments,
        });
    } catch (error) {
        console.error('POST /api/emails error:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
