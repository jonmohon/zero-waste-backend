/**
 * Order confirmation email. Sent on `order.placed`. Includes the
 * line-item table, totals, shipping address, and a link back to the
 * order on the storefront for status tracking.
 */
import {
  BRAND,
  RenderedEmail,
  SITE_URL,
  buttonHtml,
  escapeHtml,
  formatMoney,
  layout,
} from "./layout"

export interface OrderItem {
  title: string
  quantity: number
  unit_price: number
  total: number
}

export interface OrderShippingAddress {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
}

export interface OrderPlacedEmailData {
  display_id: number | string
  email: string
  currency_code: string
  subtotal: number
  shipping_total: number
  tax_total: number
  total: number
  items: OrderItem[]
  shipping_address?: OrderShippingAddress | null
  customer_first_name?: string | null
}

export function renderOrderPlacedEmail(
  data: OrderPlacedEmailData
): RenderedEmail {
  const { display_id, currency_code, items } = data
  const greeting = data.customer_first_name?.trim()
    ? `Thanks, ${escapeHtml(data.customer_first_name.trim())}.`
    : "Thanks for your order."
  const subject = `Order #${display_id} confirmed`
  const preheader = `We've received your order and we're packing it now.`

  const itemRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;color:${BRAND.primary};">
          <div style="font-weight:600;">${escapeHtml(i.title)}</div>
          <div style="font-size:12px;color:${BRAND.textSecondary};margin-top:2px;">Qty ${i.quantity} &middot; ${formatMoney(i.unit_price, currency_code)} each</div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;color:${BRAND.primary};text-align:right;white-space:nowrap;vertical-align:top;">${formatMoney(i.total, currency_code)}</td>
      </tr>`
    )
    .join("")

  const totalsRow = (label: string, amount: number, bold = false) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:${bold ? BRAND.primary : BRAND.textSecondary};${bold ? "font-weight:700;" : ""}text-align:right;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:13px;color:${BRAND.primary};${bold ? "font-weight:700;" : ""}text-align:right;width:110px;white-space:nowrap;">${formatMoney(amount, currency_code)}</td>
    </tr>`

  const addr = data.shipping_address
  const addressBlock = addr
    ? `
    <div style="margin-top:24px;padding:16px 18px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:12px;">
      <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.14em;font-size:10px;color:${BRAND.textSecondary};margin-bottom:6px;">Shipping to</div>
      <div style="font-size:14px;line-height:1.55;color:${BRAND.primary};">
        ${escapeHtml(`${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim())}<br />
        ${escapeHtml(addr.address_1 ?? "")}${addr.address_2 ? `<br />${escapeHtml(addr.address_2)}` : ""}<br />
        ${escapeHtml([addr.city, addr.province, addr.postal_code].filter(Boolean).join(", "))}<br />
        ${escapeHtml(addr.country_code?.toUpperCase() ?? "")}
      </div>
    </div>`
    : ""

  const bodyHtml = `
    <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.18em;font-size:10px;color:${BRAND.accent};margin-bottom:14px;">Order #${escapeHtml(String(display_id))}</div>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:28px;line-height:1.25;color:${BRAND.primary};">${greeting}</h1>
    <p style="margin:0 0 24px;color:${BRAND.textSecondary};">We&rsquo;ve received your order and we&rsquo;re packing it now. You&rsquo;ll get another email with tracking once it ships.</p>

    <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.14em;font-size:10px;color:${BRAND.textSecondary};margin-bottom:8px;">Items</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:8px;">
      ${itemRows}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px;">
      ${totalsRow("Subtotal", data.subtotal)}
      ${totalsRow("Shipping", data.shipping_total)}
      ${data.tax_total ? totalsRow("Tax", data.tax_total) : ""}
      <tr><td colspan="2" style="border-top:1px solid ${BRAND.border};padding:0;line-height:0;">&nbsp;</td></tr>
      ${totalsRow("Total", data.total, true)}
    </table>

    ${addressBlock}

    ${buttonHtml(`${SITE_URL}/account`, "View order")}

    <div style="border-top:1px solid ${BRAND.border};padding-top:18px;font-size:13px;line-height:1.65;color:${BRAND.textSecondary};">
      Questions? Reply to this email and we&rsquo;ll respond within 24 hours.
    </div>
  `

  const text = [
    `Order #${display_id} confirmed`,
    "",
    "Thanks for your order. We've received it and we're packing it now.",
    "",
    "Items:",
    ...items.map(
      (i) =>
        `  ${i.title} x${i.quantity} — ${formatMoney(i.total, currency_code)}`
    ),
    "",
    `Subtotal: ${formatMoney(data.subtotal, currency_code)}`,
    `Shipping: ${formatMoney(data.shipping_total, currency_code)}`,
    data.tax_total ? `Tax: ${formatMoney(data.tax_total, currency_code)}` : "",
    `Total: ${formatMoney(data.total, currency_code)}`,
    "",
    `View order: ${SITE_URL}/account`,
  ]
    .filter(Boolean)
    .join("\n")

  return { subject, html: layout({ preheader, bodyHtml }), text }
}
