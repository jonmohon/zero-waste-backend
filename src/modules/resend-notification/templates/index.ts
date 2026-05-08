/**
 * Template registry. Maps the `template` string passed to the
 * notification module to a concrete render function. A subscriber
 * publishes a notification with `template: "invite-user"` and this map
 * resolves it to `renderInviteEmail`.
 *
 * Adding a new transactional email is a matter of:
 *   1. Creating a render function in `./<name>.ts` returning RenderedEmail
 *   2. Registering it here keyed by stable ID
 *   3. Calling `notificationModuleService.createNotifications(...)` from
 *      a subscriber with that ID as `template`
 */
import { RenderedEmail } from "./layout"
import { renderInviteEmail, InviteEmailData } from "./invite"
import {
  renderCustomerWelcomeEmail,
  CustomerWelcomeEmailData,
} from "./customer-welcome"
import { renderOrderPlacedEmail, OrderPlacedEmailData } from "./order-placed"
import {
  renderPasswordResetEmail,
  PasswordResetEmailData,
} from "./password-reset"

export const TEMPLATES = {
  "invite-user": renderInviteEmail,
  "customer-welcome": renderCustomerWelcomeEmail,
  "order-placed": renderOrderPlacedEmail,
  "password-reset": renderPasswordResetEmail,
} as const

export type TemplateId = keyof typeof TEMPLATES

export type TemplateData = {
  "invite-user": InviteEmailData
  "customer-welcome": CustomerWelcomeEmailData
  "order-placed": OrderPlacedEmailData
  "password-reset": PasswordResetEmailData
}

/**
 * Resolves a template ID + data to a fully rendered email. Throws if
 * the template ID isn't registered, since that means the subscriber and
 * provider drifted and silently dropping the message would mask the bug.
 */
export function renderTemplate(
  template: string,
  data: Record<string, unknown>
): RenderedEmail {
  const render = TEMPLATES[template as TemplateId]
  if (!render) {
    throw new Error(`Unknown email template: ${template}`)
  }
  /* The map's union return type is wider than any single render fn —
     casting on the way out is fine because the runtime value matches
     the registered renderer. */
  return (render as (d: unknown) => RenderedEmail)(data)
}
