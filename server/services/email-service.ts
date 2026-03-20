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
    console.error("[EMAIL] RESEND_API_KEY not configured — email not sent:", { to, subject });
    throw new Error(
      "Correo no configurado: falta RESEND_API_KEY en el servidor."
    );
  }
  const from = process.env.EMAIL_FROM || "noreply@rmscore.app";
  const { data, error } = await client.emails.send({
    from,
    to,
    subject,
    html,
  });
  if (error) {
    console.error("[EMAIL] Resend API error:", error);
    throw new Error(error.message || "Resend rechazó el envío del correo.");
  }
  console.log(`[EMAIL] Sent to ${to}: ${subject}`, data?.id ? `(id ${data.id})` : "");
}
