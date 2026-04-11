# Zero Waste Backend — Operations

Stuff you need to run, deploy, and maintain the Medusa backend. The big
picture (current state, launch checklist, decisions needed) lives in
the storefront repo's `LAUNCH.md` and `ARCHITECTURE.md` — read those
first if you're picking the project up.

---

## Quick reference

| Thing                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| EC2 instance           | `zero-waste` (i-09656da68b455dea2) at `34.229.205.244`               |
| AWS profile            | `nexvato`                                                            |
| SSH                    | `ssh -i ~/.ssh/zero-waste-ec2 ubuntu@34.229.205.244`                 |
| Remote path            | `/opt/zero-waste-backend`                                            |
| Systemd unit           | `zero-waste`                                                         |
| Database (Neon)        | `ep-autumn-paper-amraubj9-pooler.c-5.us-east-1.aws.neon.tech/neondb` |
| Local DB               | `postgres://jonathanmohon@localhost:5432/zero_waste`                 |
| Publishable API key    | `pk_b6f1caa6bdeed4103437df2e24b4506da8134b69531975cee427603dd226bb89`|
| Admin user             | admin@zerowaste.com / admin123                                       |

---

## Run locally

```bash
cd /Volumes/T9/Development/zero-waste-backend

# Make sure local Postgres is running and the zero_waste DB exists
psql -U jonathanmohon -d zero_waste -c "SELECT 1;"

# Dev server (port 9000)
npx medusa develop

# Admin UI: http://localhost:9000/app
# Store API: http://localhost:9000/store/...
```

The `.env` is checked in (sans secrets). It points at the local DB by
default. To run a one-shot script against prod, **always** use a
`DATABASE_URL=...` env override rather than editing `.env`.

---

## Deploy to EC2

```bash
EC2_HOST=34.229.205.244 KEY=~/.ssh/zero-waste-ec2 bash deploy/push.sh
```

This rsyncs the local working tree to `/opt/zero-waste-backend`,
installs deps, runs migrations, and restarts the systemd unit.

```bash
# View logs
ssh -i ~/.ssh/zero-waste-ec2 ubuntu@34.229.205.244 \
  'sudo journalctl -u zero-waste -f --since "5 minutes ago"'

# Manual restart
ssh -i ~/.ssh/zero-waste-ec2 ubuntu@34.229.205.244 \
  'sudo systemctl restart zero-waste'
```

---

## Run a one-shot script

```bash
# Local
npx medusa exec ./src/scripts/<script>.ts

# Prod (Neon)
DATABASE_URL='postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require' \
  npx medusa exec ./src/scripts/<script>.ts
```

---

## Product import (Shopify CSV → Medusa)

The two-stage pipeline lives in `scripts/build-import-data.py` (Python)
and `src/scripts/import-products.ts` (TypeScript). End-to-end flow:

```bash
# 1. Drop the new CSV at /Users/jonathanmohon/Downloads/products_export_1.csv
#    or pass a different path:
python3 scripts/build-import-data.py --csv path/to/file.csv

# What that does:
#   - Parses + dedupes Shopify rows
#   - Slugifies handles, dedupes SKUs (Shopify's UPC scientific-notation
#     export collides — see the script comment)
#   - Downloads every image
#   - Converts to webp via Pillow (max 1600px, q82)
#   - Saves to ../zero-waste/public/products/<handle>/<n>.webp
#   - Writes scripts/products-import.json
#
# Idempotent: re-running only redownloads missing images.

# 2. Sanity-check the JSON
python3 -c "import json; d=json.load(open('scripts/products-import.json')); \
  print('products:', len(d['products']), 'categories:', d['categories'])"

# 3. Import to local DB to verify
npx medusa exec ./src/scripts/import-products.ts

# 4. Import to prod
DATABASE_URL='postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require' \
  npx medusa exec ./src/scripts/import-products.ts

# 5. Commit + push the new webp images on the storefront side
cd ../zero-waste
git add public/products
git commit -m "refresh product images"
git push
```

`import-products.ts` is **destructive** — it soft-deletes every existing
product, category, and tag before recreating from the JSON. Sales
channel, region, stock location, shipping profile, and the publishable
API key are NOT touched (so you don't need to re-run `seed.ts` after).

If the prod region somehow loses its sales channel / shipping profile
(it shouldn't), re-run `pnpm seed` once first.

---

## Database operations

```bash
# Connect to local
psql -U jonathanmohon -d zero_waste

# Connect to prod (Neon)
psql 'postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require'

# Active product count
psql ... -c "SELECT count(*) FROM product WHERE deleted_at IS NULL;"

# Recent orders
psql ... -c "SELECT id, display_id, status, email, total, created_at \
  FROM \"order\" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20;"
```

**Migrations** are managed by Medusa and run automatically on backend
deploy via systemd. Don't write raw SQL DDL.

---

## Adding a new module

Anything substantive (Stripe, Resend, custom payment provider, etc.) is
configured in `medusa-config.ts` under the `modules` key. The pattern:

```ts
import { defineConfig, Modules } from "@medusajs/framework/utils"

export default defineConfig({
  // ...
  modules: {
    [Modules.PAYMENT]: {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_API_KEY,
            },
          },
        ],
      },
    },
  },
})
```

Then add the env var to:
- Local `.env`
- EC2 `/opt/zero-waste-backend/.env` (`scp` or edit via SSH)
- Restart the systemd unit on EC2

See the storefront's `LAUNCH.md` for full Stripe + Resend wiring instructions.

---

## Background jobs / subscribers

Live in `src/jobs/<name>.ts` and `src/subscribers/<name>.ts`. The
storefront's `LAUNCH.md` has the order-confirmation-email subscriber
recipe (Tier 1 #4).

---

## Things to know

1. **Soft deletes** — products / categories / orders all soft-delete.
   When debugging "I deleted it but it's still there", filter
   `WHERE deleted_at IS NULL`.
2. **Sales channel** — every product needs to be linked to a sales
   channel or it won't show up via the publishable API key. The
   import script handles this; manual creates via admin should default
   to "Default Sales Channel".
3. **Region currency** — the prod region is USD. Don't change the
   currency on an existing region without rebuilding price lists.
4. **Idempotent scripts** — `import-products.ts` is safe to re-run.
   `seed.ts` is **not** — it's intended for a fresh DB only.
5. **Customer-scoped endpoints** require an authenticated session on
   the SDK client (cookie-based by default). Order retrieval, address
   book, etc. all need this.

---

_Pair with the storefront repo's `LAUNCH.md` and `ARCHITECTURE.md`._
