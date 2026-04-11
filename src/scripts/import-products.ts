/**
 * @file Import products from a normalized JSON file (built from a Shopify CSV
 *   export by `scripts/build-import-data.py`).
 *
 * @description
 * Wipes all existing products and product categories from the store, then
 * recreates them from `scripts/products-import.json`. Sales channel, region,
 * stock location, shipping profile, and the publishable API key are NOT
 * touched — they must already exist (run `pnpm seed` once if this is a fresh DB).
 *
 * Each imported product is created with:
 * - One variant (the CSV's single SKU per product)
 * - The first image as the thumbnail and all images attached
 * - 100 units of inventory at the default stock location
 * - Status published or draft based on the JSON `status` field
 *
 * @example
 *   pnpm medusa exec ./src/scripts/import-products.ts
 *
 * @module scripts/import-products
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductTagsWorkflow,
  createProductsWorkflow,
  deleteProductCategoriesWorkflow,
  deleteProductTagsWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Shape of each product entry in `scripts/products-import.json`,
 * produced by `build-import-data.py`.
 */
type ImportProduct = {
  handle: string;
  title: string;
  description: string;
  vendor: string;
  category: string;
  status: "published" | "draft";
  tags: string[];
  sku: string;
  /** Price in cents (USD). */
  price: number;
  compare_at_price: number | null;
  weight: number;
  inventory: number;
  thumbnail: string | null;
  images: string[];
};

type ImportFile = {
  categories: string[];
  products: ImportProduct[];
};

/**
 * Imports products from `scripts/products-import.json`.
 *
 * Idempotent: deletes any products and categories that exist before
 * recreating them, so you can re-run after editing the JSON.
 *
 * @param root0 - Medusa execution arguments.
 * @param root0.container - Medusa DI container.
 */
export default async function importProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL);
  const fulfillmentService = container.resolve(Modules.FULFILLMENT);
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION);

  // ── Load JSON ──────────────────────────────────────────────────────
  const jsonPath = resolve(process.cwd(), "scripts/products-import.json");
  logger.info(`Loading import data from ${jsonPath}`);
  const data: ImportFile = JSON.parse(readFileSync(jsonPath, "utf-8"));
  logger.info(
    `Loaded ${data.products.length} products and ${data.categories.length} categories from JSON`
  );

  // ── Resolve required infrastructure ────────────────────────────────
  const [defaultSalesChannel] = await salesChannelService.listSalesChannels({
    name: "Default Sales Channel",
  });
  if (!defaultSalesChannel) {
    throw new Error(
      "Default Sales Channel not found. Run `pnpm seed` first to bootstrap the store."
    );
  }

  const shippingProfiles = await fulfillmentService.listShippingProfiles({
    type: "default",
  });
  const shippingProfile = shippingProfiles[0];
  if (!shippingProfile) {
    throw new Error(
      "Default shipping profile not found. Run `pnpm seed` first."
    );
  }

  const [stockLocation] = await stockLocationService.listStockLocations({});
  if (!stockLocation) {
    throw new Error("No stock location found. Run `pnpm seed` first.");
  }

  // ── Wipe existing products ─────────────────────────────────────────
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id"],
  });
  if (existingProducts.length > 0) {
    logger.info(`Deleting ${existingProducts.length} existing products...`);
    await deleteProductsWorkflow(container).run({
      input: { ids: existingProducts.map((p: { id: string }) => p.id) },
    });
  }

  // ── Wipe existing tags ─────────────────────────────────────────────
  const { data: existingTags } = await query.graph({
    entity: "product_tag",
    fields: ["id"],
  });
  if (existingTags.length > 0) {
    logger.info(`Deleting ${existingTags.length} existing tags...`);
    await deleteProductTagsWorkflow(container).run({
      input: { ids: existingTags.map((t: { id: string }) => t.id) },
    });
  }

  // ── Wipe existing categories ───────────────────────────────────────
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id"],
  });
  if (existingCategories.length > 0) {
    logger.info(`Deleting ${existingCategories.length} existing categories...`);
    await deleteProductCategoriesWorkflow(container).run({
      input: existingCategories.map((c: { id: string }) => c.id),
    });
  }

  // ── Create new categories ──────────────────────────────────────────
  logger.info(`Creating ${data.categories.length} categories...`);
  const { result: createdCategories } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: data.categories.map((name) => ({
        name,
        is_active: true,
      })),
    },
  });

  /** Map category name → category id, for fast lookup when creating products. */
  const categoryIdByName = new Map<string, string>(
    createdCategories.map((c) => [c.name, c.id])
  );

  // ── Create unique tags up-front ────────────────────────────────────
  const uniqueTagValues = Array.from(
    new Set(data.products.flatMap((p) => p.tags))
  );
  const tagIdByValue = new Map<string, string>();
  if (uniqueTagValues.length > 0) {
    logger.info(`Creating ${uniqueTagValues.length} tags...`);
    const { result: createdTags } = await createProductTagsWorkflow(
      container
    ).run({
      input: {
        product_tags: uniqueTagValues.map((value) => ({ value })),
      },
    });
    for (const tag of createdTags) {
      tagIdByValue.set(tag.value, tag.id);
    }
  }

  // ── Create products in batches ─────────────────────────────────────
  // Batches keep the workflow request size + memory under control on the
  // ~120-product import.
  const BATCH_SIZE = 20;
  const salesChannels = [{ id: defaultSalesChannel.id }];

  for (let i = 0; i < data.products.length; i += BATCH_SIZE) {
    const batch = data.products.slice(i, i + BATCH_SIZE);
    logger.info(
      `Creating products ${i + 1}–${i + batch.length} of ${data.products.length}...`
    );

    await createProductsWorkflow(container).run({
      input: {
        products: batch.map((p) => {
          const categoryId = categoryIdByName.get(p.category);
          return {
            title: p.title,
            handle: p.handle,
            description: p.description || undefined,
            // Vendor → Medusa metadata so we don't lose it
            metadata: p.vendor ? { vendor: p.vendor } : undefined,
            category_ids: categoryId ? [categoryId] : [],
            thumbnail: p.thumbnail ?? undefined,
            images: p.images.map((url) => ({ url })),
            weight: p.weight || undefined,
            status:
              p.status === "published"
                ? ProductStatus.PUBLISHED
                : ProductStatus.DRAFT,
            shipping_profile_id: shippingProfile.id,
            tag_ids: p.tags.length
              ? (p.tags
                  .map((v) => tagIdByValue.get(v))
                  .filter((id): id is string => !!id))
              : undefined,
            options: [{ title: "Default", values: ["Default"] }],
            variants: [
              {
                title: "Default",
                sku: p.sku,
                manage_inventory: true,
                options: { Default: "Default" },
                prices: [{ amount: p.price, currency_code: "usd" }],
              },
            ],
            sales_channels: salesChannels,
          };
        }),
      },
    });
  }

  // ── Stock all variants at the default location ─────────────────────
  // Query every inventory item and create a level wherever none exists yet.
  type InventoryItemWithLevels = {
    id: string;
    location_levels?: ({ location_id: string } | null)[] | null;
  };
  const { data: inventoryItems } = (await query.graph({
    entity: "inventory_item",
    fields: ["id", "location_levels.location_id"],
  })) as { data: InventoryItemWithLevels[] };

  const itemsNeedingLevel = inventoryItems.filter((item) => {
    const levels = (item.location_levels ?? []).filter(
      (l): l is { location_id: string } => l != null
    );
    return !levels.some((l) => l.location_id === stockLocation.id);
  });

  if (itemsNeedingLevel.length > 0) {
    logger.info(`Stocking ${itemsNeedingLevel.length} inventory items...`);
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: itemsNeedingLevel.map((item) => ({
          inventory_item_id: item.id,
          location_id: stockLocation.id,
          stocked_quantity: 100,
        })),
      },
    });
  }

  logger.info("✓ Product import complete.");
}
