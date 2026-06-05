/**
 * Customer-MLM-rebuild Phase 3: welcome email template.
 *
 * Sent exactly once by `otpAuthService.completeCustomerSignupSideEffects`
 * after the customer successfully verifies their signup OTP. The email
 * congratulates the new member, surfaces their referral code prominently
 * so they can start sharing immediately, and points them to the rewards
 * dashboard.
 *
 * IMPORTANT — branding rule: the word "MLM" MUST NEVER appear anywhere
 * in this template. Customer-facing communications consistently brand
 * the feature as the "Rewards Program" / "Referral Program". Internal
 * admin tooling is allowed to keep the MLM acronym, but every email,
 * push, in-app string and template seen by the customer is scrubbed.
 *
 * The template returns `{subject, text, html}` so the underlying
 * mail-transport call site stays generic.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildCtaUrl({ ctaUrl }) {
  if (ctaUrl && /^https?:\/\//i.test(ctaUrl)) return ctaUrl;
  const base = String(process.env.FRONTEND_URL || "").trim();
  if (base) return `${base.replace(/\/$/, "")}/mlm`;
  return null;
}

export function buildCustomerWelcomeEmail({
  name,
  referralCode,
  ctaUrl,
  appName,
  // Optional login credential echo. When present, the email renders
  // a dedicated "Your login credentials" panel so the user has a
  // single record of how to sign in. See the SECURITY NOTE on
  // `Customer._signupPasswordPlaintext` for the trade-off discussion.
  loginEmail,
  loginPhone,
  loginPassword,
  // Phase 7 (PO-request): short public-facing User ID. Doubles as
  // a login identifier on its own (User ID + password). Documented
  // on `app/utils/userIdGenerator.js`.
  loginUserId,
}) {
  const safeName = escapeHtml(name || "there");
  const safeCode = escapeHtml(referralCode || "");
  const safeAppName = escapeHtml(
    appName || process.env.MAIL_FROM_NAME || "Shop & Earn",
  );
  const cta = buildCtaUrl({ ctaUrl });

  const safeLoginEmail = escapeHtml(loginEmail || "");
  const safeLoginPhone = escapeHtml(loginPhone || "");
  const safeLoginPassword = escapeHtml(loginPassword || "");
  const safeLoginUserId = escapeHtml(loginUserId || "");
  const hasCredentials = Boolean(
    safeLoginEmail ||
      safeLoginPhone ||
      safeLoginPassword ||
      safeLoginUserId,
  );

  const subject = `Welcome to the Rewards Program, ${name || "there"}!`;

  const credentialsTextLines = hasCredentials
    ? [
        "",
        "Your login credentials:",
        loginUserId ? `  • User ID:  ${loginUserId}` : "",
        loginEmail ? `  • Email:    ${loginEmail}` : "",
        loginPhone ? `  • Phone:    ${loginPhone}` : "",
        loginPassword ? `  • Password: ${loginPassword}` : "",
        "",
        "You can sign in with any of: User ID + password, Email + password, or Phone + OTP.",
        "Keep this email private — anyone who can read it can sign in as you. We recommend changing your password after your first login.",
      ].filter(Boolean)
    : [];

  const text = [
    `Hi ${name || "there"},`,
    "",
    "Congratulations — your Rewards Program account is ready.",
    "",
    referralCode
      ? `Your referral code is: ${referralCode}`
      : "Your referral code will appear on your dashboard.",
    ...credentialsTextLines,
    "",
    "Share this code with friends and family. Every time someone signs up using your code, they become part of your network and you start building your team.",
    "",
    "What you can do right now:",
    "  • Open the app and copy your referral code from the dashboard.",
    "  • Share your code on WhatsApp / SMS / social media.",
    "  • Track your team's growth on the Genealogy page.",
    "  • Activate the earning plan whenever you're ready to unlock payouts.",
    "",
    cta ? `Open your dashboard: ${cta}` : "",
    "",
    `Welcome aboard,`,
    `The ${appName || "Shop & Earn"} Team`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");

  const html = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:14px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;">${safeAppName}</p>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.3;color:#0f172a;">Welcome to the Rewards Program, ${safeName}!</h1>
                <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#334155;">
                  Congratulations — your account is ready and you are officially part of the earning program.
                </p>
              </td>
            </tr>
            ${
              safeCode
                ? `
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);border-radius:12px;padding:20px 24px;color:#ffffff;">
                  <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Your Referral Code</p>
                  <p style="margin:6px 0 0;font-size:28px;letter-spacing:0.16em;font-weight:700;">${safeCode}</p>
                </div>
              </td>
            </tr>`
                : ""
            }
            ${
              hasCredentials
                ? `
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;">
                  <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#475569;font-weight:700;">Your Login Credentials</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;color:#0f172a;">
                    ${
                      safeLoginUserId
                        ? `<tr>
                              <td style="padding:6px 0;width:96px;color:#64748b;">User ID</td>
                              <td style="padding:6px 0;font-family:'Courier New',monospace;font-weight:700;letter-spacing:0.08em;">${safeLoginUserId}</td>
                            </tr>`
                        : ""
                    }
                    ${
                      safeLoginEmail
                        ? `<tr>
                              <td style="padding:6px 0;width:96px;color:#64748b;">Email</td>
                              <td style="padding:6px 0;font-weight:600;word-break:break-all;">${safeLoginEmail}</td>
                            </tr>`
                        : ""
                    }
                    ${
                      safeLoginPhone
                        ? `<tr>
                              <td style="padding:6px 0;color:#64748b;">Phone</td>
                              <td style="padding:6px 0;font-weight:600;">${safeLoginPhone}</td>
                            </tr>`
                        : ""
                    }
                    ${
                      safeLoginPassword
                        ? `<tr>
                              <td style="padding:6px 0;color:#64748b;">Password</td>
                              <td style="padding:6px 0;font-family:'Courier New',monospace;font-weight:700;letter-spacing:0.04em;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;display:inline-block;">${safeLoginPassword}</td>
                            </tr>`
                        : ""
                    }
                  </table>
                  <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
                    Keep this email private — anyone who can read it can sign in as you. We recommend changing your password after your first login.
                  </p>
                </div>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">
                  Share this code with friends and family. Every person who signs up using your code becomes part of your network — and your network is what builds your earnings.
                </p>
                <p style="margin:16px 0 0;font-size:15px;font-weight:700;color:#0f172a;">What you can do right now:</p>
                <ul style="margin:8px 0 0 18px;padding:0;color:#334155;font-size:15px;line-height:1.7;">
                  <li>Copy your referral code from the dashboard.</li>
                  <li>Share it on WhatsApp, SMS or social media.</li>
                  <li>Track your team on the Genealogy page.</li>
                  <li>Activate the earning plan whenever you're ready to unlock payouts.</li>
                </ul>
              </td>
            </tr>
            ${
              cta
                ? `
            <tr>
              <td align="center" style="padding:24px 32px 32px 32px;">
                <a href="${escapeHtml(cta)}"
                   style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:10px;">
                  Open My Dashboard
                </a>
              </td>
            </tr>`
                : `<tr><td style="padding-bottom:32px;"></td></tr>`
            }
            <tr>
              <td style="padding:0 32px 24px 32px;border-top:1px solid #e2e8f0;">
                <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
                  You're receiving this email because someone signed up at ${safeAppName} using this email address. If that wasn't you, please ignore this message.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  return { subject, text, html };
}
