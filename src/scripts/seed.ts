/**
 * @file Seed script for the Zero Waste e-commerce store (Medusa v2).
 *
 * @description
 * Bootstraps the entire store from scratch: store configuration, sales channel,
 * US region with tax zones, stock location (Austin warehouse), fulfillment
 * providers, shipping options (Eco Ground + Express), a publishable API key,
 * six product categories, 24 zero-waste products with variants, and initial
 * inventory levels (500 units per SKU).
 *
 * **Product categories:**
 * - Bath & Body -- soaps, scrubs, razors, starter kits
 * - Hair Care -- shampoo bars, conditioner bars, brushes
 * - Kitchen -- dish brushes, food wraps, bottles, cloths, cleaning kits
 * - Laundry -- detergent sheets, dryer balls
 * - Oral Hygiene -- toothbrushes, toothpaste tablets, dental floss
 * - Skin Care -- beauty kits, face moisturizer
 *
 * All prices are in USD cents (e.g. $34.99 = 3499).
 *
 * @example
 * // Run via Medusa CLI
 * pnpm seed
 *
 * @module scripts/seed
 */
import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ApiKey } from "../../.medusa/types/query-entry-points";

/**
 * Helper workflow that updates supported currencies on the store.
 *
 * @param input - Object containing the store ID and an array of currency
 *   definitions with their default flag.
 * @returns The updated store records from {@link updateStoresStep}.
 */
const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => ({
              currency_code: currency.currency_code,
              is_default: currency.is_default ?? false,
            })
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);
    return new WorkflowResponse(stores);
  }
);

/**
 * Seeds the Zero Waste store with demo data.
 *
 * Idempotent for the sales channel and API key (checks before creating),
 * but products/categories/regions are always created fresh -- intended to
 * run against an empty database.
 *
 * @param root0 - Medusa execution arguments.
 * @param root0.container - The dependency-injection container providing
 *   access to all Medusa modules, the query runner, and the link service.
 */
export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  /* US-focused store */
  const countries = ["us"];

  // ── Store & Sales Channel ──────────────────────────────────────────
  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [{ name: "Default Sales Channel" }],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        { currency_code: "usd", is_default: true },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  // ── Region (US) ────────────────────────────────────────────────────
  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "United States",
          currency_code: "usd",
          countries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];
  logger.info("Finished seeding regions.");

  // ── Tax ────────────────────────────────────────────────────────────
  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({
      country_code,
      provider_id: "tp_system",
    })),
  });
  logger.info("Finished seeding tax regions.");

  // ── Stock Location ─────────────────────────────────────────────────
  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Zero Waste Warehouse",
          address: {
            city: "Austin",
            country_code: "US",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { default_location_id: stockLocation.id },
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });

  // ── Fulfillment & Shipping ─────────────────────────────────────────
  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [{ name: "Default Shipping Profile", type: "default" }],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "US Shipping",
    type: "shipping",
    service_zones: [
      {
        name: "United States",
        geo_zones: [{ country_code: "us", type: "country" }],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Eco Ground Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Eco Ground",
          description: "Carbon-neutral shipping in 3-5 business days.",
          code: "eco-ground",
        },
        prices: [
          { currency_code: "usd", amount: 500 },
          { region_id: region.id, amount: 500 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ships in 1-2 business days.",
          code: "express",
        },
        prices: [
          { currency_code: "usd", amount: 1200 },
          { region_id: region.id, amount: 1200 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  // ── Publishable API Key ────────────────────────────────────────────
  logger.info("Seeding publishable API key data...");
  let publishableApiKey: ApiKey | null = null;
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id"],
    filters: { type: "publishable" },
  });

  publishableApiKey = data?.[0];

  if (!publishableApiKey) {
    const {
      result: [publishableApiKeyResult],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          { title: "Zero Waste Storefront", type: "publishable", created_by: "" },
        ],
      },
    });
    publishableApiKey = publishableApiKeyResult as ApiKey;
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  // ── Product Categories ─────────────────────────────────────────────
  logger.info("Seeding product data...");
  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        { name: "Bath & Body", is_active: true },
        { name: "Hair Care", is_active: true },
        { name: "Kitchen", is_active: true },
        { name: "Laundry", is_active: true },
        { name: "Oral Hygiene", is_active: true },
        { name: "Skin Care", is_active: true },
      ],
    },
  });

  /**
   * Resolves a product category ID by its display name.
   *
   * @param name - Exact category name as seeded (e.g. "Bath & Body").
   * @returns The Medusa category ID string.
   * @throws {Error} If the category name does not match any seeded category.
   */
  const catId = (name: string): string => {
    const cat = categoryResult.find((c) => c.name === name);
    if (!cat) throw new Error(`Category "${name}" not found in seed results`);
    return cat.id;
  };

  // ── Products ───────────────────────────────────────────────────────
  const salesChannels = [{ id: defaultSalesChannel[0].id }];

  await createProductsWorkflow(container).run({
    input: {
      products: [
        // 1. Zero-Waste Beauty Kit
        {
          title: "Zero-Waste Beauty Kit",
          category_ids: [catId("Skin Care")],
          description:
            "A curated set of beauty essentials including soap bar, lip balm, face cloth, and cotton rounds. Everything you need for a plastic-free beauty routine.",
          handle: "zero-waste-beauty-kit",
          thumbnail: "https://images.unsplash.com/photo-1563391506244-af91a410fcc9?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1563391506244-af91a410fcc9?w=800&q=85" }],
          weight: 350,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "ZW-BEAUTY-KIT",
              options: { Set: "Standard" },
              prices: [{ amount: 3499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 2. Shea Butter Soap Bar
        {
          title: "Shea Butter Soap Bar",
          category_ids: [catId("Bath & Body")],
          description:
            "Handmade with organic shea butter, gentle on skin and plastic-free. Nourishing lather that leaves skin soft and hydrated.",
          handle: "shea-butter-soap-bar",
          thumbnail: "https://images.unsplash.com/photo-1547904558-dedfe53b51d7?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1547904558-dedfe53b51d7?w=800&q=85" }],
          weight: 120,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Scent", values: ["Lavender", "Rose", "Unscented"] },
          ],
          variants: [
            {
              title: "Lavender",
              sku: "SHEA-SOAP-LAV",
              options: { Scent: "Lavender" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
            {
              title: "Rose",
              sku: "SHEA-SOAP-ROSE",
              options: { Scent: "Rose" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
            {
              title: "Unscented",
              sku: "SHEA-SOAP-UNS",
              options: { Scent: "Unscented" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 3. Coffee Body Scrub with Lemongrass
        {
          title: "Coffee Body Scrub with Lemongrass",
          category_ids: [catId("Bath & Body")],
          description:
            "Upcycled coffee grounds blended with lemongrass essential oil. Exfoliates and invigorates skin naturally. 200g jar.",
          handle: "coffee-body-scrub-lemongrass",
          thumbnail: "https://images.unsplash.com/photo-1681880096619-0fe10e24b048?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1681880096619-0fe10e24b048?w=800&q=85" }],
          weight: 250,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["200g"] },
          ],
          variants: [
            {
              title: "200g",
              sku: "COFFEE-SCRUB-200",
              options: { Size: "200g" },
              prices: [{ amount: 1499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 4. Amber Glass Spray Bottle 3 Pack
        {
          title: "Amber Glass Spray Bottle 3 Pack",
          category_ids: [catId("Kitchen")],
          description:
            "Refillable amber glass spray bottles, 500ml each. Durable, chemical-resistant, and perfect for homemade cleaning solutions.",
          handle: "amber-glass-spray-bottle-3pack",
          thumbnail: "https://images.unsplash.com/photo-1560521166-99f8bed834f5?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1560521166-99f8bed834f5?w=800&q=85" }],
          weight: 800,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["3 Pack"] },
          ],
          variants: [
            {
              title: "3 Pack",
              sku: "AMBER-SPRAY-3PK",
              options: { Set: "3 Pack" },
              prices: [{ amount: 1999, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 5. Zero-Waste Cleaning Kit
        {
          title: "Zero-Waste Cleaning Kit",
          category_ids: [catId("Kitchen")],
          description:
            "Includes dish brush, cleaning tablets, spray bottle, and cotton cloths. Everything you need to clean your home without single-use plastic.",
          handle: "zero-waste-cleaning-kit",
          thumbnail: "https://images.unsplash.com/photo-1583907659441-addbe699e921?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1583907659441-addbe699e921?w=800&q=85" }],
          weight: 600,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "ZW-CLEAN-KIT",
              options: { Set: "Standard" },
              prices: [{ amount: 2999, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 6. Safety Razor - Anthracite
        {
          title: "Safety Razor",
          category_ids: [catId("Bath & Body")],
          description:
            "Reusable metal safety razor for plastic-free shaving. Precision-engineered with a weighted handle for a smooth, close shave.",
          handle: "safety-razor",
          thumbnail: "https://images.unsplash.com/photo-1563635707357-edc8f574fd01?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1563635707357-edc8f574fd01?w=800&q=85" }],
          weight: 100,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Color", values: ["Anthracite", "Rose Gold", "Silver"] },
          ],
          variants: [
            {
              title: "Anthracite",
              sku: "RAZOR-ANTH",
              options: { Color: "Anthracite" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
            {
              title: "Rose Gold",
              sku: "RAZOR-RGOLD",
              options: { Color: "Rose Gold" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
            {
              title: "Silver",
              sku: "RAZOR-SILVER",
              options: { Color: "Silver" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 7. Red Clay Soap Bar
        {
          title: "Red Clay Soap Bar",
          category_ids: [catId("Bath & Body")],
          description:
            "Natural red clay soap bar for detoxifying and cleansing. Rich in minerals, draws out impurities and leaves skin feeling refreshed.",
          handle: "red-clay-soap-bar",
          thumbnail: "https://images.unsplash.com/photo-1603533627544-4b256401b1ee?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1603533627544-4b256401b1ee?w=800&q=85" }],
          weight: 120,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "RCLAY-SOAP",
              options: { Size: "Standard" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 8. 2-in-1 Shampoo + Conditioner Bar
        {
          title: "2-in-1 Shampoo + Conditioner Bar",
          category_ids: [catId("Hair Care")],
          description:
            "Solid shampoo and conditioner bar that lasts 80+ washes. Sulfate-free, plastic-free, and perfect for travel.",
          handle: "2in1-shampoo-conditioner-bar",
          thumbnail: "https://images.unsplash.com/photo-1542038335240-86aea625b913?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1542038335240-86aea625b913?w=800&q=85" }],
          weight: 85,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Hair Type", values: ["Normal Hair", "Dry Hair", "Oily Hair"] },
          ],
          variants: [
            {
              title: "Normal Hair",
              sku: "SBAR-NORMAL",
              options: { "Hair Type": "Normal Hair" },
              prices: [{ amount: 1299, currency_code: "usd" }],
            },
            {
              title: "Dry Hair",
              sku: "SBAR-DRY",
              options: { "Hair Type": "Dry Hair" },
              prices: [{ amount: 1299, currency_code: "usd" }],
            },
            {
              title: "Oily Hair",
              sku: "SBAR-OILY",
              options: { "Hair Type": "Oily Hair" },
              prices: [{ amount: 1299, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 9. Cotton Nut Milk Bag
        {
          title: "Cotton Nut Milk Bag",
          category_ids: [catId("Kitchen")],
          description:
            "Organic cotton mesh bag for making homemade nut milk, juice, and straining. Fine weave catches pulp while letting liquid flow freely.",
          handle: "cotton-nut-milk-bag",
          thumbnail: "https://images.unsplash.com/photo-1595909315417-2edd382a56dc?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1595909315417-2edd382a56dc?w=800&q=85" }],
          weight: 40,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "NUT-MILK-BAG",
              options: { Size: "Standard" },
              prices: [{ amount: 699, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 10. Zero-Waste Bathroom Starter Kit
        {
          title: "Zero-Waste Bathroom Starter Kit",
          category_ids: [catId("Bath & Body")],
          description:
            "Bamboo toothbrush, shampoo bar, safety razor, cotton rounds, and soap bar. The complete kit to make your bathroom plastic-free.",
          handle: "zero-waste-bathroom-starter-kit",
          thumbnail: "https://images.unsplash.com/photo-1563635707334-5ce91b375ea6?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1563635707334-5ce91b375ea6?w=800&q=85" }],
          weight: 500,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "ZW-BATH-KIT",
              options: { Set: "Standard" },
              prices: [{ amount: 3999, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 11. Bamboo Dish Brush
        {
          title: "Bamboo Dish Brush",
          category_ids: [catId("Kitchen")],
          description:
            "Compostable bamboo dish brush with replaceable head. Sturdy natural bristles cut through grease without scratching.",
          handle: "bamboo-dish-brush",
          thumbnail: "https://images.unsplash.com/photo-1587027768084-c3a9076c0a43?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1587027768084-c3a9076c0a43?w=800&q=85" }],
          weight: 80,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "BAM-DISH-BRUSH",
              options: { Size: "Standard" },
              prices: [{ amount: 799, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 12. Bamboo Toothbrush 4-Pack
        {
          title: "Bamboo Toothbrush 4-Pack",
          category_ids: [catId("Oral Hygiene")],
          description:
            "Sustainably sourced bamboo handles with charcoal-infused bristles. Compostable handle, recyclable bristles. Family 4-pack lasts a year.",
          handle: "bamboo-toothbrush-4pack",
          thumbnail: "https://images.unsplash.com/photo-1563635707529-6d73084e17ce?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1563635707529-6d73084e17ce?w=800&q=85" }],
          weight: 60,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Bristle", values: ["Soft", "Medium"] },
          ],
          variants: [
            {
              title: "Soft",
              sku: "BTOOTH-SOFT",
              options: { Bristle: "Soft" },
              prices: [{ amount: 999, currency_code: "usd" }],
            },
            {
              title: "Medium",
              sku: "BTOOTH-MED",
              options: { Bristle: "Medium" },
              prices: [{ amount: 999, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 13. Toothpaste Tablets
        {
          title: "Toothpaste Tablets",
          category_ids: [catId("Oral Hygiene")],
          description:
            "Plastic-free toothpaste in tablet form, fluoride-free. 60 tablets per tin. Just chew, brush, and rinse.",
          handle: "toothpaste-tablets",
          thumbnail: "https://images.unsplash.com/photo-1633878353926-7a98d66aa6da?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1633878353926-7a98d66aa6da?w=800&q=85" }],
          weight: 50,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Flavor", values: ["Mint", "Charcoal"] },
          ],
          variants: [
            {
              title: "Mint",
              sku: "TPASTE-TAB-MINT",
              options: { Flavor: "Mint" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
            {
              title: "Charcoal",
              sku: "TPASTE-TAB-CHAR",
              options: { Flavor: "Charcoal" },
              prices: [{ amount: 899, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 14. Dental Floss in Glass Jar
        {
          title: "Dental Floss in Glass Jar",
          category_ids: [catId("Oral Hygiene")],
          description:
            "Biodegradable silk dental floss in a refillable glass jar. Naturally waxed with candelilla wax, mint-flavored.",
          handle: "dental-floss-glass-jar",
          thumbnail: "https://images.unsplash.com/photo-1559818469-fdf7a1ae929c?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1559818469-fdf7a1ae929c?w=800&q=85" }],
          weight: 45,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "DFLOSS-GLASS",
              options: { Size: "Standard" },
              prices: [{ amount: 599, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 15. Beeswax Food Wraps 3-Pack
        {
          title: "Beeswax Food Wraps 3-Pack",
          category_ids: [catId("Kitchen")],
          description:
            "Reusable beeswax wraps to replace plastic wrap. Made with organic cotton, beeswax, jojoba oil, and tree resin. Washable and reusable for up to a year.",
          handle: "beeswax-food-wraps-3pack",
          thumbnail: "https://images.unsplash.com/photo-1633878353720-7a49a4a3d0ec?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1633878353720-7a49a4a3d0ec?w=800&q=85" }],
          weight: 120,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Small Pack (S/M/L)", "Large Pack (M/L/XL)"] },
          ],
          variants: [
            {
              title: "Small Pack (S/M/L)",
              sku: "BW-WRAP-SM",
              options: { Size: "Small Pack (S/M/L)" },
              prices: [{ amount: 1899, currency_code: "usd" }],
            },
            {
              title: "Large Pack (M/L/XL)",
              sku: "BW-WRAP-LG",
              options: { Size: "Large Pack (M/L/XL)" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 16. Stainless Steel Water Bottle
        {
          title: "Stainless Steel Water Bottle",
          category_ids: [catId("Kitchen")],
          description:
            "Double-walled vacuum insulated, keeps drinks cold 24hrs or hot 12hrs. Powder-coated finish, leak-proof lid. BPA-free.",
          handle: "stainless-steel-water-bottle",
          thumbnail: "https://images.unsplash.com/photo-1649867219867-3faeab653df9?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1649867219867-3faeab653df9?w=800&q=85" }],
          weight: 340,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["500ml", "750ml"] },
            { title: "Color", values: ["Forest Green", "Matte Black", "Sand"] },
          ],
          variants: [
            {
              title: "500ml / Forest Green",
              sku: "SWB-500-GRN",
              options: { Size: "500ml", Color: "Forest Green" },
              prices: [{ amount: 2899, currency_code: "usd" }],
            },
            {
              title: "500ml / Matte Black",
              sku: "SWB-500-BLK",
              options: { Size: "500ml", Color: "Matte Black" },
              prices: [{ amount: 2899, currency_code: "usd" }],
            },
            {
              title: "500ml / Sand",
              sku: "SWB-500-SND",
              options: { Size: "500ml", Color: "Sand" },
              prices: [{ amount: 2899, currency_code: "usd" }],
            },
            {
              title: "750ml / Forest Green",
              sku: "SWB-750-GRN",
              options: { Size: "750ml", Color: "Forest Green" },
              prices: [{ amount: 3499, currency_code: "usd" }],
            },
            {
              title: "750ml / Matte Black",
              sku: "SWB-750-BLK",
              options: { Size: "750ml", Color: "Matte Black" },
              prices: [{ amount: 3499, currency_code: "usd" }],
            },
            {
              title: "750ml / Sand",
              sku: "SWB-750-SND",
              options: { Size: "750ml", Color: "Sand" },
              prices: [{ amount: 3499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 17. Laundry Detergent Sheets
        {
          title: "Laundry Detergent Sheets",
          category_ids: [catId("Laundry")],
          description:
            "Pre-measured, ultra-concentrated laundry detergent sheets that dissolve completely in hot or cold water. Zero-waste packaging, no plastic jugs.",
          handle: "laundry-detergent-sheets",
          thumbnail: "https://images.unsplash.com/photo-1626806819282-2c1dc01a5e0c?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1626806819282-2c1dc01a5e0c?w=800&q=85" }],
          weight: 150,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Scent", values: ["Fresh Linen", "Unscented"] },
          ],
          variants: [
            {
              title: "Fresh Linen",
              sku: "LAUNDRY-SHEETS-FL",
              options: { Scent: "Fresh Linen" },
              prices: [{ amount: 2099, currency_code: "usd" }],
            },
            {
              title: "Unscented",
              sku: "LAUNDRY-SHEETS-UNS",
              options: { Scent: "Unscented" },
              prices: [{ amount: 2099, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 18. Wool Dryer Balls 6-Pack
        {
          title: "Wool Dryer Balls 6-Pack",
          category_ids: [catId("Laundry")],
          description:
            "100% New Zealand wool dryer balls that naturally soften clothes and reduce drying time by up to 25%. Replaces single-use dryer sheets for 1,000+ loads.",
          handle: "wool-dryer-balls-6pack",
          thumbnail: "https://images.unsplash.com/photo-1530396333989-24c5b8f805dd?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1530396333989-24c5b8f805dd?w=800&q=85" }],
          weight: 300,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["6-Pack"] },
          ],
          variants: [
            {
              title: "6-Pack",
              sku: "DRYER-BALLS-6",
              options: { Set: "6-Pack" },
              prices: [{ amount: 1699, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 19. Shampoo Bar
        {
          title: "Shampoo Bar",
          category_ids: [catId("Hair Care")],
          description:
            "Sulfate-free solid shampoo bar that lasts 60+ washes. Gentle formula with natural essential oils, plastic-free packaging.",
          handle: "shampoo-bar",
          thumbnail: "https://images.unsplash.com/photo-1570040546652-7811017b628b?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1570040546652-7811017b628b?w=800&q=85" }],
          weight: 85,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Scent", values: ["Bloom", "Peppermint", "Unscented"] },
          ],
          variants: [
            {
              title: "Bloom",
              sku: "SHAMPOO-BAR-BLM",
              options: { Scent: "Bloom" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
            {
              title: "Peppermint",
              sku: "SHAMPOO-BAR-PEP",
              options: { Scent: "Peppermint" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
            {
              title: "Unscented",
              sku: "SHAMPOO-BAR-UNS",
              options: { Scent: "Unscented" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 20. Conditioner Bar
        {
          title: "Conditioner Bar",
          category_ids: [catId("Hair Care")],
          description:
            "Solid conditioner bar that deeply nourishes and detangles. Long-lasting, travel-friendly, and completely plastic-free.",
          handle: "conditioner-bar",
          thumbnail: "https://images.unsplash.com/photo-1546552768-9e3a94b38a59?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1546552768-9e3a94b38a59?w=800&q=85" }],
          weight: 85,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Hair Type", values: ["Normal", "Dry", "Oily"] },
          ],
          variants: [
            {
              title: "Normal",
              sku: "COND-BAR-NORM",
              options: { "Hair Type": "Normal" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
            {
              title: "Dry",
              sku: "COND-BAR-DRY",
              options: { "Hair Type": "Dry" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
            {
              title: "Oily",
              sku: "COND-BAR-OILY",
              options: { "Hair Type": "Oily" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 21. Bamboo Hair Brush
        {
          title: "Bamboo Hair Brush",
          category_ids: [catId("Hair Care")],
          description:
            "Eco-friendly bamboo hair brush with natural bristles. Gentle on scalp, reduces static, and promotes healthy hair. Biodegradable handle.",
          handle: "bamboo-hair-brush",
          thumbnail: "https://images.unsplash.com/photo-1633878351657-d5188a7ce7b1?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1633878351657-d5188a7ce7b1?w=800&q=85" }],
          weight: 120,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "BAMBOO-BRUSH",
              options: { Size: "Standard" },
              prices: [{ amount: 2199, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 22. Face Moisturizer
        {
          title: "Face Moisturizer",
          category_ids: [catId("Skin Care")],
          description:
            "Lightweight, all-natural face moisturizer in a glass jar. Made with jojoba oil, shea butter, and vitamin E. Plastic-free packaging.",
          handle: "face-moisturizer",
          thumbnail: "https://images.unsplash.com/photo-1591134608223-67005960e763?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1591134608223-67005960e763?w=800&q=85" }],
          weight: 100,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Standard"] },
          ],
          variants: [
            {
              title: "Standard",
              sku: "FACE-MOIST",
              options: { Size: "Standard" },
              prices: [{ amount: 1899, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 23. Reusable Paper Towels 12-Pack
        {
          title: "Reusable Paper Towels 12-Pack",
          category_ids: [catId("Kitchen")],
          description:
            "Washable, reusable paper towel replacements made from organic cotton and cellulose. Each sheet replaces up to 80 disposable paper towels.",
          handle: "reusable-paper-towels-12pack",
          thumbnail: "https://images.unsplash.com/photo-1635352558665-0b01650e9b84?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1635352558665-0b01650e9b84?w=800&q=85" }],
          weight: 200,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["12-Pack"] },
          ],
          variants: [
            {
              title: "12-Pack",
              sku: "REUSE-TOWELS-12",
              options: { Set: "12-Pack" },
              prices: [{ amount: 2799, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        // 24. Swedish Dish Cloth
        {
          title: "Swedish Dish Cloth",
          category_ids: [catId("Kitchen")],
          description:
            "Compostable Swedish dish cloth made from cotton and cellulose. Absorbs 15x its weight, replaces 17 rolls of paper towels. Machine washable.",
          handle: "swedish-dish-cloth",
          thumbnail: "https://images.unsplash.com/photo-1550963295-019d8a8a61c5?w=800&q=85",
          images: [{ url: "https://images.unsplash.com/photo-1550963295-019d8a8a61c5?w=800&q=85" }],
          weight: 30,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Pattern", values: ["Lemons", "Herbs", "Plain"] },
          ],
          variants: [
            {
              title: "Lemons",
              sku: "SWEDISH-CLOTH-LEM",
              options: { Pattern: "Lemons" },
              prices: [{ amount: 549, currency_code: "usd" }],
            },
            {
              title: "Herbs",
              sku: "SWEDISH-CLOTH-HRB",
              options: { Pattern: "Herbs" },
              prices: [{ amount: 549, currency_code: "usd" }],
            },
            {
              title: "Plain",
              sku: "SWEDISH-CLOTH-PLN",
              options: { Pattern: "Plain" },
              prices: [{ amount: 549, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
      ],
    },
  });
  logger.info("Finished seeding product data.");

  // ── Inventory ──────────────────────────────────────────────────────
  logger.info("Seeding inventory levels.");
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = inventoryItems.map(
    (item) => ({
      location_id: stockLocation.id,
      stocked_quantity: 500,
      inventory_item_id: item.id,
    })
  );

  await createInventoryLevelsWorkflow(container).run({
    input: { inventory_levels: inventoryLevels },
  });

  logger.info("Finished seeding inventory levels data.");
  logger.info("Zero Waste store seeded successfully!");
}
