/**
 * Subscriber: send the password reset email when Medusa generates a
 * reset token. Fires on `auth.password_reset` for both customer and
 * admin actor types — we route to the right URL based on `actor_type`.
 *
 * Payload shape (from Medusa's AuthWorkflowEvents):
 *   {
 *     entity_id, // identifier of the user/customer (an email address)
 *     actor_type, // "customer" | "user" | custom
 *     token,
 *     metadata,
 *   }
 */
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/framework/types"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://zerowastesimplified.com"
const ADMIN_URL =
  process.env.ADMIN_URL ?? "https://admin.zerowastesimplified.com/app"

interface PasswordResetPayload {
  entity_id: string
  actor_type: string
  token: string
  metadata?: Record<string, unknown>
}

export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<PasswordResetPayload>) {
  const notificationModule = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const { entity_id: email, actor_type, token } = data
  if (!email || !token) return

  const isAdmin = actor_type === "user"
  const base = isAdmin ? ADMIN_URL : STOREFRONT_URL
  const path = isAdmin ? "reset-password" : "reset-password"
  const resetUrl = `${base.replace(/\/+$/, "")}/${path}?token=${encodeURIComponent(
    token
  )}&email=${encodeURIComponent(email)}`

  await notificationModule.createNotifications({
    to: email,
    channel: "email",
    template: "password-reset",
    data: {
      email,
      reset_url: resetUrl,
      actor_type,
    },
  })
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
