/**
 * Subscriber: send the admin-team invite email when a new invite is
 * created. Fires on `user.invite.created` (which Medusa emits when an
 * existing admin uses the "Invite User" flow).
 *
 * The invite token is stored on the invite entity itself; we fetch it
 * by ID so the email contains a working accept link.
 */
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/framework/types"

export default async function inviteCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const userModule = container.resolve(Modules.USER) as {
    retrieveInvite: (id: string) => Promise<{
      id: string
      email: string
      token: string
    }>
  }
  const notificationModule = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const invite = await userModule.retrieveInvite(data.id)

  await notificationModule.createNotifications({
    to: invite.email,
    channel: "email",
    template: "invite-user",
    data: {
      email: invite.email,
      token: invite.token,
    },
  })
}

export const config: SubscriberConfig = {
  event: "user.invite.created",
}
