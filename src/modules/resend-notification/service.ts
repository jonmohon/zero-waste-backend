/**
 * Resend notification provider for Medusa v2.
 *
 * Implements the v2 AbstractNotificationProviderService so the
 * notification module can route emails to it. Subscribers call
 * `notificationModuleService.createNotifications({ to, template,
 * data, channel: "email" })` and Medusa hands the payload to
 * `send()` here. We render via the local template registry, then
 * dispatch through Resend's HTTPS API.
 */
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend } from "resend"
import { renderTemplate } from "./templates"

type InjectedDependencies = {
  logger: Logger
}

export type ResendProviderOptions = {
  /** Resend API key. Server-only, read from env in medusa-config. */
  api_key: string
  /** Verified `From:` header — must match a verified Resend domain. */
  from: string
  /** Optional global Reply-To. Most templates also let subscribers override. */
  reply_to?: string
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "resend"

  protected readonly logger_: Logger
  protected readonly options_: ResendProviderOptions
  protected readonly client_: Resend

  constructor(
    { logger }: InjectedDependencies,
    options: ResendProviderOptions
  ) {
    super()
    this.logger_ = logger
    this.options_ = options
    this.client_ = new Resend(options.api_key)
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend provider: `api_key` is required"
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend provider: `from` is required (verified Resend sender)"
      )
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification.to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend provider: notification is missing `to`"
      )
    }
    if (!notification.template) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend provider: notification is missing `template`"
      )
    }

    const rendered = renderTemplate(
      notification.template,
      (notification.data ?? {}) as Record<string, unknown>
    )

    /* Subscribers can override the From header per-notification by
       passing `provider_data.from`. Useful for things like sending
       order emails from `orders@` while admin invites come from
       `team@`, all under the same verified domain. */
    const providerData = (notification.provider_data ?? {}) as {
      from?: string
      reply_to?: string
      cc?: string | string[]
      bcc?: string | string[]
    }

    try {
      const { data, error } = await this.client_.emails.send({
        from: providerData.from || notification.from || this.options_.from,
        to: [notification.to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: providerData.reply_to ?? this.options_.reply_to,
        cc: providerData.cc,
        bcc: providerData.bcc,
      })

      if (error) {
        this.logger_.error(
          `[resend] failed to send '${notification.template}' to ${notification.to}: ${error.message}`
        )
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Resend send failed: ${error.message}`
        )
      }

      return { id: data?.id ?? "" }
    } catch (err) {
      if (err instanceof MedusaError) throw err
      this.logger_.error(
        `[resend] unexpected error sending '${notification.template}' to ${notification.to}: ${(err as Error).message}`
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Resend send threw: ${(err as Error).message}`
      )
    }
  }
}

export default ResendNotificationProviderService
