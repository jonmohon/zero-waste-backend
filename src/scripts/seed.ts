/**
 * Seed script for Zero Waste store.
 *
 * Creates: store config, sales channel, region (US), tax regions,
 * stock location, fulfillment/shipping, publishable API key,
 * product categories, and zero-waste products with variants.
 *
 * Run with: pnpm seed (or yarn seed)
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

/** Helper workflow to set store currencies */
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
        { name: "Kitchen", is_active: true },
        { name: "Bathroom", is_active: true },
        { name: "On the Go", is_active: true },
        { name: "Home", is_active: true },
      ],
    },
  });

  // ── Products ───────────────────────────────────────────────────────
  const salesChannels = [{ id: defaultSalesChannel[0].id }];

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Beeswax Food Wraps (3-Pack)",
          category_ids: [
            categoryResult.find((c) => c.name === "Kitchen")!.id,
          ],
          description:
            "Replace plastic wrap for good. These organic cotton wraps coated in beeswax, jojoba oil, and tree resin mold to any shape with the warmth of your hands. Washable and reusable for up to a year.",
          handle: "beeswax-food-wraps",
          weight: 120,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Size", values: ["Small Pack", "Large Pack"] },
          ],
          variants: [
            {
              title: "Small Pack (S/M/L)",
              sku: "BW-WRAP-SM",
              options: { Size: "Small Pack" },
              prices: [{ amount: 1899, currency_code: "usd" }],
            },
            {
              title: "Large Pack (M/L/XL)",
              sku: "BW-WRAP-LG",
              options: { Size: "Large Pack" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        {
          title: "Bamboo Utensil Kit",
          category_ids: [
            categoryResult.find((c) => c.name === "On the Go")!.id,
          ],
          description:
            "A compact travel set with bamboo fork, knife, spoon, chopsticks, and a straw — all in a rolled cotton carrying pouch. Never use disposable cutlery again.",
          handle: "bamboo-utensil-kit",
          weight: 180,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Color", values: ["Natural", "Charcoal"] },
          ],
          variants: [
            {
              title: "Natural",
              sku: "BAM-UTN-NAT",
              options: { Color: "Natural" },
              prices: [{ amount: 1499, currency_code: "usd" }],
            },
            {
              title: "Charcoal",
              sku: "BAM-UTN-CHR",
              options: { Color: "Charcoal" },
              prices: [{ amount: 1499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        {
          title: "Shampoo Bar — Lavender & Oat",
          category_ids: [
            categoryResult.find((c) => c.name === "Bathroom")!.id,
          ],
          description:
            "One bar replaces 2-3 bottles of liquid shampoo. Made with organic coconut oil, shea butter, and essential oils. Sulfate-free, plastic-free, and lasts up to 80 washes.",
          handle: "shampoo-bar-lavender",
          weight: 85,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Scent", values: ["Lavender & Oat", "Mint & Tea Tree", "Unscented"] },
          ],
          variants: [
            {
              title: "Lavender & Oat",
              sku: "SBAR-LAV",
              options: { Scent: "Lavender & Oat" },
              prices: [{ amount: 1299, currency_code: "usd" }],
            },
            {
              title: "Mint & Tea Tree",
              sku: "SBAR-MINT",
              options: { Scent: "Mint & Tea Tree" },
              prices: [{ amount: 1299, currency_code: "usd" }],
            },
            {
              title: "Unscented",
              sku: "SBAR-UNS",
              options: { Scent: "Unscented" },
              prices: [{ amount: 1199, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        {
          title: "Stainless Steel Water Bottle",
          category_ids: [
            categoryResult.find((c) => c.name === "On the Go")!.id,
          ],
          description:
            "Double-walled vacuum insulation keeps drinks cold 24hrs or hot 12hrs. Powder-coated finish, leak-proof lid, fits standard cup holders. BPA-free.",
          handle: "steel-water-bottle",
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
        {
          title: "Compost Bin — Countertop",
          category_ids: [
            categoryResult.find((c) => c.name === "Kitchen")!.id,
          ],
          description:
            "Sleek 1.3-gallon stainless steel compost bin with charcoal filters to eliminate odors. Dishwasher-safe inner bucket. Sits neatly on any countertop.",
          handle: "countertop-compost-bin",
          weight: 900,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Finish", values: ["Brushed Steel", "Matte White"] },
          ],
          variants: [
            {
              title: "Brushed Steel",
              sku: "COMP-BIN-STL",
              options: { Finish: "Brushed Steel" },
              prices: [{ amount: 3999, currency_code: "usd" }],
            },
            {
              title: "Matte White",
              sku: "COMP-BIN-WHT",
              options: { Finish: "Matte White" },
              prices: [{ amount: 3999, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        {
          title: "Bamboo Toothbrush (4-Pack)",
          category_ids: [
            categoryResult.find((c) => c.name === "Bathroom")!.id,
          ],
          description:
            "Sustainably harvested bamboo handles with charcoal-infused BPA-free bristles. Compostable handle, recyclable bristles. Family 4-pack lasts a year.",
          handle: "bamboo-toothbrush-4pack",
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
        {
          title: "Reusable Produce Bags (Set of 6)",
          category_ids: [
            categoryResult.find((c) => c.name === "On the Go")!.id,
          ],
          description:
            "Lightweight organic cotton mesh bags in three sizes. Replace hundreds of plastic produce bags per year. Machine washable with drawstring closure.",
          handle: "reusable-produce-bags",
          weight: 150,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Set", values: ["Standard (6-pack)", "Bulk (12-pack)"] },
          ],
          variants: [
            {
              title: "Standard (6-pack)",
              sku: "PROD-BAG-6",
              options: { Set: "Standard (6-pack)" },
              prices: [{ amount: 1599, currency_code: "usd" }],
            },
            {
              title: "Bulk (12-pack)",
              sku: "PROD-BAG-12",
              options: { Set: "Bulk (12-pack)" },
              prices: [{ amount: 2499, currency_code: "usd" }],
            },
          ],
          sales_channels: salesChannels,
        },
        {
          title: "Organic Cotton Tote Bag",
          category_ids: [
            categoryResult.find((c) => c.name === "On the Go")!.id,
          ],
          description:
            "Heavy-duty 10oz organic cotton tote with reinforced handles. Carries up to 40lbs. GOTS certified, unbleached, undyed — the last grocery bag you will ever need.",
          handle: "organic-cotton-tote",
          weight: 280,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [
            { title: "Style", values: ["Natural", "Earth Print"] },
          ],
          variants: [
            {
              title: "Natural",
              sku: "TOTE-NAT",
              options: { Style: "Natural" },
              prices: [{ amount: 1899, currency_code: "usd" }],
            },
            {
              title: "Earth Print",
              sku: "TOTE-EARTH",
              options: { Style: "Earth Print" },
              prices: [{ amount: 2199, currency_code: "usd" }],
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
  logger.info("🌱 Zero Waste store seeded successfully!");
}
