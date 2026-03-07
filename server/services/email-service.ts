import { Resend } from 'resend';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log('[EMAIL] RESEND_API_KEY not configured. Email content:', { to, subject });
    return;
  }
  try {
    await client.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@rmscore.app',
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send email:', error);
  }
}
