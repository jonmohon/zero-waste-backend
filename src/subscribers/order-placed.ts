/**
 * Subscriber: send the order confirmation email when an order is
 * placed. Fires on `order.placed`.
 *
 * The order entity has nested items, totals, and a shipping address;
 * we project them down to the simpler shape the template expects so
 * future Medusa schema changes only need a one-place update.
 */
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import {
  INotificationModuleService,
  IOrderModuleService,
} from "@medusajs/framework/types"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderModule = container.resolve(
    Modules.ORDER
  ) as IOrderModuleService
  const notificationModule = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const order = (await orderModule.retrieveOrder(data.id, {
    relations: ["items", "shipping_address"],
  })) as unknown as {
    display_id: number
    email: string | null
    currency_code: string
    item_subtotal: number
    shipping_subtotal: number
    tax_total: number
    total: number
    items: Array<{
      title: string
      quantity: number
      unit_price: number
      subtotal: number
    }>
    shipping_address: {
      first_name?: string | null
      last_name?: string | null
      address_1?: string | null
      address_2?: string | null
      city?: string | null
      province?: string | null
      postal_code?: string | null
      country_code?: string | null
    } | null
  }

  if (!order.email) return

  /* Medusa stores money as raw numbers (the v2 BigNumber type). For an
     order in cents (USD), `total: 1999` means $19.99. The template's
     `formatMoney` divides by 100, which assumes cents — adjust if your
     currency uses a different smallest unit. */
  await notificationModule.createNotifications({
    to: order.email,
    channel: "email",
    template: "order-placed",
    data: {
      display_id: order.display_id,
      email: order.email,
      currency_code: order.currency_code,
      subtotal: numberOf(order.item_subtotal),
      shipping_total: numberOf(order.shipping_subtotal),
      tax_total: numberOf(order.tax_total),
      total: numberOf(order.total),
      items: order.items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        unit_price: numberOf(i.unit_price),
        total: numberOf(i.subtotal),
      })),
      shipping_address: order.shipping_address,
      customer_first_name: order.shipping_address?.first_name ?? null,
    },
  })
}

/** Medusa v2 BigNumber values can come through as objects — normalize. */
function numberOf(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "string") return Number(v)
  if (v && typeof v === "object" && "numeric_" in v) {
    return Number((v as { numeric_: number }).numeric_)
  }
  return 0
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
