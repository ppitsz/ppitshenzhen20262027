import { NextResponse } from 'next/server';
import { deliverEmail } from '@/lib/email/deliver';
import { updateEmailStatus } from '../../../../services/email';
import { adminOnly } from '@/lib/email/admin';

export const maxDuration = 300;

/*
  POST { to, subject, html, text, emailId?, attachmentFiles?, isIndividual? }  (website admins only)
  Sends right away through PPIT Shenzhen's Gmail. The email sender and crons don't use this
  route any more: they call deliverEmail directly (services/email.js).
*/
export async function POST(request) {
    const denied = await adminOnly(request);
    if (denied) return denied;

    try {
        const { to, subject, html, text, emailId, attachmentFiles, isIndividual } = await request.json();

        if (!to || to.length === 0) {
            return NextResponse.json({ error: 'No recipients specified' }, { status: 400 });
        }

        const result = await deliverEmail({ to, subject, html, text, attachmentFiles, isIndividual: isIndividual !== false });

        if (emailId) {
            await updateEmailStatus(emailId, 'sent', result.failed > 0 ? `${result.failed} recipients failed` : null);
        }

        return NextResponse.json({
            success: true,
            message: result.message,
            results: { successful: result.sent, failed: result.failed, details: result.details },
        });
    } catch (error) {
        console.error('❌ Email sending error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
