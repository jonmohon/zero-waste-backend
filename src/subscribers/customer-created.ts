/**
 * Subscriber: send the customer welcome email after a new customer
 * registers. Fires on `customer.created`.
 */
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import {
  INotificationModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types"

export default async function customerCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const customerModule = container.resolve(
    Modules.CUSTOMER
  ) as ICustomerModuleService
  const notificationModule = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const customer = await customerModule.retrieveCustomer(data.id)
  if (!customer.email) return

  /* Skip guest checkouts — they already get the order confirmation,
     and a welcome email to a one-off shopper is just noise. */
  if (!customer.has_account) return

  await notificationModule.createNotifications({
    to: customer.email,
    channel: "email",
    template: "customer-welcome",
    data: {
      email: customer.email,
      first_name: customer.first_name,
    },
  })
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
