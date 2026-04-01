/**
 * Seed script for Zero Waste store.
 *
 * Creates: store config, sales channel, region (US), tax regions,
 * stock location, fulfillment/shipping, publishable API key,
 * product categories, and zero-waste products with variants.
 *
 * Categories: Beauty, Cleaning Products, Dental Care, Kitchen,
 * Bathroom, Gifts & Kits.
 *
 * All prices are in USD cents (e.g. $34.99 = 3499).
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
        { name: "Beauty", is_active: true },
        { name: "Cleaning Products", is_active: true },
        { name: "Dental Care", is_active: true },
        { name: "Kitchen", is_active: true },
        { name: "Bathroom", is_active: true },
        { name: "Gifts & Kits", is_active: true },
      ],
    },
  });

  /**
   * Helper to look up a category ID by name.
   * Throws if the category was not seeded.
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
          category_ids: [catId("Gifts & Kits")],
          description:
            "A curated set of beauty essentials including soap bar, lip balm, face cloth, and cotton rounds. Everything you need for a plastic-free beauty routine.",
          handle: "zero-waste-beauty-kit",
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
          category_ids: [catId("Beauty")],
          description:
            "Handmade with organic shea butter, gentle on skin and plastic-free. Nourishing lather that leaves skin soft and hydrated.",
          handle: "shea-butter-soap-bar",
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
          category_ids: [catId("Beauty")],
          description:
            "Upcycled coffee grounds blended with lemongrass essential oil. Exfoliates and invigorates skin naturally. 200g jar.",
          handle: "coffee-body-scrub-lemongrass",
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
          category_ids: [catId("Cleaning Products")],
          description:
            "Refillable amber glass spray bottles, 500ml each. Durable, chemical-resistant, and perfect for homemade cleaning solutions.",
          handle: "amber-glass-spray-bottle-3pack",
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
          category_ids: [catId("Gifts & Kits")],
          description:
            "Includes dish brush, cleaning tablets, spray bottle, and cotton cloths. Everything you need to clean your home without single-use plastic.",
          handle: "zero-waste-cleaning-kit",
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
          category_ids: [catId("Beauty")],
          description:
            "Reusable metal safety razor for plastic-free shaving. Precision-engineered with a weighted handle for a smooth, close shave.",
          handle: "safety-razor",
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
          category_ids: [catId("Beauty")],
          description:
            "Natural red clay soap bar for detoxifying and cleansing. Rich in minerals, draws out impurities and leaves skin feeling refreshed.",
          handle: "red-clay-soap-bar",
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
          category_ids: [catId("Bathroom")],
          description:
            "Solid shampoo and conditioner bar that lasts 80+ washes. Sulfate-free, plastic-free, and perfect for travel.",
          handle: "2in1-shampoo-conditioner-bar",
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
          category_ids: [catId("Gifts & Kits")],
          description:
            "Bamboo toothbrush, shampoo bar, safety razor, cotton rounds, and soap bar. The complete kit to make your bathroom plastic-free.",
          handle: "zero-waste-bathroom-starter-kit",
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
          category_ids: [catId("Dental Care")],
          description:
            "Sustainably sourced bamboo handles with charcoal-infused bristles. Compostable handle, recyclable bristles. Family 4-pack lasts a year.",
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
        // 13. Toothpaste Tablets
        {
          title: "Toothpaste Tablets",
          category_ids: [catId("Dental Care")],
          description:
            "Plastic-free toothpaste in tablet form, fluoride-free. 60 tablets per tin. Just chew, brush, and rinse.",
          handle: "toothpaste-tablets",
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
          category_ids: [catId("Dental Care")],
          description:
            "Biodegradable silk dental floss in a refillable glass jar. Naturally waxed with candelilla wax, mint-flavored.",
          handle: "dental-floss-glass-jar",
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
