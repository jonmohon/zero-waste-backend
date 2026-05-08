/**
 * Module-provider entry for the Resend notification provider.
 *
 * Registered against the core notification module in medusa-config.ts:
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/notification",
 *       options: {
 *         providers: [
 *           {
 *             resolve: "./src/modules/resend-notification",
 *             id: "resend",
 *             options: { api_key, from, channels: ["email"] },
 *           },
 *         ],
 *       },
 *     },
 *   ]
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ResendNotificationProviderService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [ResendNotificationProviderService],
})
