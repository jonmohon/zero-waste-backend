/**
 * Customer welcome email. Sent on `customer.created`. Friendly, brand
 * forward, no sales pitch. Uses the customer's first name when present.
 */
import {
  BRAND,
  RenderedEmail,
  SITE_URL,
  buttonHtml,
  escapeHtml,
  layout,
} from "./layout"

export interface CustomerWelcomeEmailData {
  email: string
  first_name?: string | null
}

export function renderCustomerWelcomeEmail(
  data: CustomerWelcomeEmailData
): RenderedEmail {
  const firstName = data.first_name?.trim()
  const greeting = firstName ? `Welcome, ${escapeHtml(firstName)}.` : "Welcome."
  const subject = "Welcome to Zero Waste Simplified"
  const preheader = "Your account is set up — small swaps, big impact."

  const bodyHtml = `
    <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.18em;font-size:10px;color:${BRAND.accent};margin-bottom:14px;">Account created</div>
    <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:30px;line-height:1.2;color:${BRAND.primary};">${greeting}</h1>
    <p style="margin:0 0 16px;">Your account is set up. From here you can track orders, save addresses for faster checkout, and keep an eye on new arrivals.</p>
    <p style="margin:0 0 24px;color:${BRAND.textSecondary};">We exist to make sustainable swaps simple. Bar by bar, refill by refill, less plastic ends up in the world.</p>
    ${buttonHtml(`${SITE_URL}/collections`, "Shop Collections")}
    <div style="border-top:1px solid ${BRAND.border};padding-top:20px;font-size:14px;line-height:1.65;color:${BRAND.textSecondary};">
      Have a swap you swear by? Hit reply &mdash; we read every message.
    </div>
  `

  const text = [
    `Welcome to Zero Waste Simplified${firstName ? `, ${firstName}` : ""}.`,
    "",
    "Your account is set up. Track orders, save addresses for faster checkout, and keep an eye on new arrivals.",
    "",
    `Shop collections: ${SITE_URL}/collections`,
    "",
    "Have a swap you swear by? Reply to this email — we read every message.",
  ].join("\n")

  return { subject, html: layout({ preheader, bodyHtml }), text }
}
