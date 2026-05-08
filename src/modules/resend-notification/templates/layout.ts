/**
 * Shared brand chrome for every transactional email sent by the Medusa
 * backend. Mirrors the storefront's email layout so the customer sees a
 * consistent visual identity across signup → order → support emails.
 *
 * Email clients have terrible CSS support — no Tailwind, no flexbox,
 * stripped <style> blocks in some Gmail flows. Everything here uses
 * inline styles + table layout for maximum compatibility (Gmail,
 * Outlook, Apple Mail, mobile clients).
 */

export const BRAND = {
  primary: "#1a2b1c",
  primaryLight: "#2a3f2c",
  accent: "#4aaa42",
  textSecondary: "#6b7c6e",
  surface: "#f7f8f5",
  surfaceSage: "#e8ede3",
  cream: "#faf8f5",
  border: "#e5e7e1",
} as const

export const SITE_URL = "https://zerowastesimplified.com"
export const ADMIN_URL = "https://admin.zerowastesimplified.com/app"
export const LOGO_URL = `${SITE_URL}/images/logo.webp`
export const SUPPORT_EMAIL = "info@zerowastesimplified.com"

/**
 * Wraps body content in the shared brand chrome — header logo, outer
 * background, footer with company info. Body should be pre-escaped HTML.
 */
export function layout(args: { preheader: string; bodyHtml: string }): string {
  const { preheader, bodyHtml } = args
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Zero Waste Simplified</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.primary};">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
            <tr>
              <td align="center" style="background:${BRAND.primary};padding:28px 24px;">
                <a href="${SITE_URL}" style="text-decoration:none;color:#ffffff;display:inline-block;">
                  <img src="${LOGO_URL}" alt="Zero Waste Simplified" width="44" height="44" style="display:block;margin:0 auto 10px;border:0;outline:none;" />
                  <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:20px;letter-spacing:0.01em;color:#ffffff;">Zero Waste Simplified</div>
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px;font-size:15px;line-height:1.65;color:${BRAND.primary};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background:${BRAND.surfaceSage};padding:24px 32px;border-top:1px solid ${BRAND.border};font-size:12px;line-height:1.6;color:${BRAND.textSecondary};text-align:center;">
                <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.14em;font-size:10px;color:${BRAND.primary};margin-bottom:8px;">Zero Waste Simplified</div>
                <div>Sustainable swaps, made simple. Cleveland, OH.</div>
                <div style="margin-top:10px;">
                  <a href="${SITE_URL}" style="color:${BRAND.accent};text-decoration:none;">zerowastesimplified.com</a>
                  &nbsp;&middot;&nbsp;
                  <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.accent};text-decoration:none;">${SUPPORT_EMAIL}</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Reusable "primary CTA" button — table-based for Outlook compatibility. */
export function buttonHtml(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;">
      <tr>
        <td style="border-radius:12px;background:${BRAND.primary};">
          <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;font-size:12px;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  `
}

/** Minimal HTML escape for user-supplied strings interpolated into emails. */
export function escapeHtml(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Format an integer-cents amount as a localized currency string. */
export function formatMoney(amountInCents: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currencyCode || "USD").toUpperCase(),
    }).format(amountInCents / 100)
  } catch {
    return `${(amountInCents / 100).toFixed(2)} ${currencyCode?.toUpperCase() ?? ""}`.trim()
  }
}

/** Output both HTML and a plain-text fallback so clients without HTML render gracefully. */
export interface RenderedEmail {
  subject: string
  html: string
  text: string
}
