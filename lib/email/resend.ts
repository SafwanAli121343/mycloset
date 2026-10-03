// Transactional email via Resend (resend.com) — the standard choice for a Next.js app sending
// verification/reset emails: a plain REST API (no SDK dependency needed), a generous free tier,
// and no AWS-SES-style sandbox approval wait before it can send to real inboxes.
//
// Two independent gates before a real send happens:
//   1. EMAIL_SENDING_LIVE — a manual on/off switch, separate from whether Resend is configured at
//      all. Lets the API key + EMAIL_FROM sit in the environment pointed at the real production
//      domain (see lib/auth/verificationCodes.ts — codes are fixed/predictable while this is off)
//      well before that domain is actually verified with Resend, without ever attempting a send
//      that would just fail. Flip to "true" once the sending domain is verified at launch.
//   2. isEmailConfigured() — a safety net in case EMAIL_SENDING_LIVE is flipped on before
//      RESEND_API_KEY/EMAIL_FROM are actually set; degrades to a console log instead of throwing.
export function isEmailSendingLive(): boolean {
  return process.env.EMAIL_SENDING_LIVE === "true";
}

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!isEmailSendingLive()) {
    console.log(`[email:test-mode] EMAIL_SENDING_LIVE is not "true" — not sending "${subject}" to ${to}. Verification/reset codes are fixed in test mode, see verificationCodes.ts.`);
    return;
  }
  if (!isEmailConfigured()) {
    console.warn(`[email:dormant] Resend not configured — would have sent "${subject}" to ${to}:\n${html}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

function codeEmailHtml(heading: string, code: string, bodyLine: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="letter-spacing: 0.04em; text-transform: uppercase;">${heading}</h2>
      <p style="color: #444; font-size: 14px;">${bodyLine}</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 0.3em; text-align: center; padding: 20px 0;">${code}</div>
      <p style="color: #888; font-size: 12px;">This code expires in ${code.length === 6 ? "15 minutes" : "a short time"}. If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
}

export async function sendVerificationCodeEmail(to: string, code: string): Promise<void> {
  await sendEmail(
    to,
    "Verify your MYCLOSET account",
    codeEmailHtml("Verify your email", code, "Enter this code in the app to verify your account:")
  );
}

export async function sendPasswordResetCodeEmail(to: string, code: string): Promise<void> {
  await sendEmail(
    to,
    "Reset your MYCLOSET password",
    codeEmailHtml("Reset your password", code, "Enter this code in the app to reset your password:")
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// A user's Feedback-page message, forwarded to the team inbox (FEEDBACK_EMAIL). The message is
// user-written text, so it's HTML-escaped; line breaks are kept.
export async function sendFeedbackEmail(to: string, fromEmail: string, platform: string, message: string): Promise<void> {
  await sendEmail(
    to,
    `MYCLOSET feedback from ${fromEmail}`,
    `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p style="color:#888; font-size:12px; margin:0 0 12px;">From ${escapeHtml(fromEmail)} · ${escapeHtml(platform)}</p>
      <div style="font-size:14px; color:#111; line-height:1.6; white-space:pre-wrap;">${escapeHtml(message)}</div>
    </div>`
  );
}
