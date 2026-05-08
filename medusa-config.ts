import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

/**
 * Branding constants — single source of truth so the storefront and the
 * admin reference the same visual identity. Update these to rebrand.
 */
const BRAND = {
  title: "Zero Waste Simplified · Admin",
  // Logo + favicon are hosted by the storefront (works cross-origin for
  // images). Swap these URLs to repoint branding without rebuilding.
  logoUrl: "https://www.zerowastesimplified.com/images/logo.webp",
  faviconUrl: "https://www.zerowastesimplified.com/images/logo.webp",
  /** Deep forest green — matches the storefront `--color-primary`. */
  primary: "#1a2b1c",
  /** Bright sage — matches the storefront `--color-accent`. */
  accent: "#4aaa42",
  cream: "#faf8f5",
} as const

/**
 * Vite plugin that brands the Medusa admin shell (index.html). Sets the
 * page title, swaps the favicon, and injects a stylesheet that applies
 * the storefront brand palette + logo to the admin chrome.
 *
 * The CSS uses broad selectors because Medusa's admin internals don't
 * expose a public theming API. If a future Medusa upgrade renames a
 * class, only the styles below need to be tightened — nothing else
 * downstream breaks.
 */
function adminBrandingPlugin() {
  const css = `
    :root {
      --color-brand-primary: ${BRAND.primary};
      --color-brand-accent: ${BRAND.accent};
      --color-brand-cream: ${BRAND.cream};
    }

    /* Override common Medusa accent variables — names taken from the
       admin's design tokens. Some may not exist in every release; the
       ones that don't simply no-op. */
    :root,
    [data-theme="light"],
    [data-theme="dark"] {
      --bg-interactive: ${BRAND.accent} !important;
      --fg-interactive: ${BRAND.accent} !important;
      --button-inverted-bg: ${BRAND.primary} !important;
      --button-inverted-fg: #ffffff !important;
      --button-primary-bg: ${BRAND.primary} !important;
      --color-bg-button-primary: ${BRAND.primary} !important;
      --color-bg-button-primary-hover: ${BRAND.accent} !important;
      --color-fg-button-primary: #ffffff !important;
      --color-bg-interactive: ${BRAND.accent} !important;
      --color-fg-interactive: ${BRAND.accent} !important;
      --color-bg-interactive-pressed: ${BRAND.primary} !important;
      --color-border-interactive: ${BRAND.accent} !important;
    }

    /* Replace the Medusa logo. Targets common patterns: img alt,
       sidebar header, link to the dashboard. Falls back to a logo block
       at the top of the sidebar if none of the originals match. */
    nav a[href$="/app"] img,
    nav a[href$="/admin"] img,
    [aria-label*="Medusa" i],
    [class*="logo"] img {
      content: url("${BRAND.logoUrl}") !important;
      max-height: 32px !important;
      width: auto !important;
      object-fit: contain !important;
    }

    /* Sidebar accent bar + active state */
    nav a[aria-current="page"],
    nav [data-active="true"] {
      color: ${BRAND.accent} !important;
    }

    /* Primary CTA buttons */
    button[type="submit"],
    [data-color="primary"],
    .btn-primary {
      background-color: ${BRAND.primary} !important;
      border-color: ${BRAND.primary} !important;
      color: #ffffff !important;
    }
    button[type="submit"]:hover,
    [data-color="primary"]:hover {
      background-color: ${BRAND.accent} !important;
      border-color: ${BRAND.accent} !important;
    }
  `.trim()

  return {
    name: "zw-admin-branding",
    transformIndexHtml(html: string) {
      const titleTag = `<title>${BRAND.title}</title>`
      const faviconTag = `<link rel="icon" type="image/webp" href="${BRAND.faviconUrl}" />`
      const styleTag = `<style data-zw-branding>${css}</style>`

      /* Medusa's admin shell ships no <title> — the SPA sets
         document.title at runtime on every route. We inject a default
         so the tab label reads correctly before React has hydrated. */
      const hasTitle = /<title>/i.test(html)
      const rewritten = hasTitle
        ? html.replace(/<title>[^<]*<\/title>/i, titleTag)
        : html.replace("</head>", `  ${titleTag}\n</head>`)

      return rewritten
        .replace(/<link\s+[^>]*rel=["']icon["'][^>]*\/?>/gi, "")
        .replace("</head>", `  ${faviconTag}\n  ${styleTag}\n</head>`)
    },
  }
}

module.exports = defineConfig({
  admin: {
    vite: () => ({
      server: {
        allowedHosts: [
          "api.zerowastesimplified.com",
          "admin.zerowastesimplified.com",
        ],
      },
      plugins: [adminBrandingPlugin()],
    }),
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    /**
     * Override the default in-memory notification module so it routes
     * through Resend on the `email` channel. The provider module lives
     * in `src/modules/resend-notification` and renders branded HTML
     * for the templates referenced by our subscribers (invite-user,
     * customer-welcome, order-placed, password-reset).
     */
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "./src/modules/resend-notification",
            id: "resend",
            options: {
              channels: ["email"],
              api_key: process.env.RESEND_API_KEY,
              from: process.env.RESEND_FROM,
            },
          },
        ],
      },
    },
  ],
})
