/**
 * Password reset email. Sent on `auth.password_reset` for both customer
 * and admin user actor types. The reset path differs per actor:
 *
 *   - customer  → storefront /reset-password?token=...
 *   - user      → admin /reset-password?token=...
 *
 * The actor type is included in the event payload, so the subscriber
 * picks the right URL and we just consume it here.
 */
import {
  BRAND,
  RenderedEmail,
  buttonHtml,
  escapeHtml,
  layout,
} from "./layout"

export interface PasswordResetEmailData {
  email: string
  reset_url: string
  actor_type: "customer" | "user" | string
}

export function renderPasswordResetEmail(
  data: PasswordResetEmailData
): RenderedEmail {
  const isAdmin = data.actor_type === "user"
  const subject = isAdmin
    ? "Reset your admin password"
    : "Reset your Zero Waste Simplified password"
  const preheader = "Use the link below to set a new password."

  const bodyHtml = `
    <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.18em;font-size:10px;color:${BRAND.accent};margin-bottom:14px;">Password reset</div>
    <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:28px;line-height:1.25;color:${BRAND.primary};">Reset your password.</h1>
    <p style="margin:0 0 14px;">We received a request to reset the password for <strong style="color:${BRAND.primary};">${escapeHtml(data.email)}</strong>.</p>
    <p style="margin:0 0 24px;color:${BRAND.textSecondary};">Click the button to set a new password. The link will expire shortly for your security.</p>
    ${buttonHtml(data.reset_url, "Reset password")}
    <div style="border-top:1px solid ${BRAND.border};padding-top:18px;font-size:13px;line-height:1.65;color:${BRAND.textSecondary};">
      Or copy and paste this URL into your browser:<br />
      <a href="${data.reset_url}" style="color:${BRAND.accent};word-break:break-all;text-decoration:none;">${escapeHtml(data.reset_url)}</a>
      <p style="margin:14px 0 0;">If you didn&rsquo;t request this, you can safely ignore this email &mdash; your password won&rsquo;t change unless someone uses the link.</p>
    </div>
  `

  const text = [
    "Reset your password — Zero Waste Simplified",
    "",
    `We received a request to reset the password for ${data.email}.`,
    "",
    "Reset link:",
    data.reset_url,
    "",
    "The link will expire shortly. If you didn't request this, ignore this email — your password won't change unless someone uses the link.",
  ].join("\n")

  return { subject, html: layout({ preheader, bodyHtml }), text }
}
