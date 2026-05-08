/**
 * Admin-team invite email. Sent when an existing admin invites a new
 * teammate to manage the store. The token is single-use; the link
 * routes through the storefront-hosted /invite redirect to the admin
 * accept-invite page so the recipient lands somewhere branded.
 */
import {
  ADMIN_URL,
  BRAND,
  RenderedEmail,
  buttonHtml,
  escapeHtml,
  layout,
} from "./layout"

export interface InviteEmailData {
  email: string
  token: string
  invited_by_name?: string
}

export function renderInviteEmail(data: InviteEmailData): RenderedEmail {
  const inviter = data.invited_by_name?.trim() || "the team"
  const acceptUrl = `${ADMIN_URL}/invite?token=${encodeURIComponent(data.token)}`
  const subject = "You're invited to the Zero Waste Simplified admin"
  const preheader = `${inviter} invited you to help run the Zero Waste Simplified store.`

  const bodyHtml = `
    <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.18em;font-size:10px;color:${BRAND.accent};margin-bottom:14px;">Admin invitation</div>
    <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:28px;line-height:1.25;color:${BRAND.primary};">You&rsquo;re in.</h1>
    <p style="margin:0 0 14px;">${escapeHtml(inviter)} has invited you to help run the Zero Waste Simplified store as an admin.</p>
    <p style="margin:0 0 24px;color:${BRAND.textSecondary};">Click the button below to accept the invite and set your password. The link is unique to you and will expire if unused.</p>
    ${buttonHtml(acceptUrl, "Accept Invitation")}
    <div style="border-top:1px solid ${BRAND.border};padding-top:18px;font-size:13px;line-height:1.65;color:${BRAND.textSecondary};">
      Or copy and paste this URL into your browser:<br />
      <a href="${acceptUrl}" style="color:${BRAND.accent};word-break:break-all;text-decoration:none;">${escapeHtml(acceptUrl)}</a>
    </div>
  `

  const text = [
    "Admin invitation — Zero Waste Simplified",
    "",
    `${inviter} has invited you to help run the Zero Waste Simplified store as an admin.`,
    "",
    "Accept your invite:",
    acceptUrl,
    "",
    "The link is unique to you and will expire if unused.",
  ].join("\n")

  return { subject, html: layout({ preheader, bodyHtml }), text }
}
