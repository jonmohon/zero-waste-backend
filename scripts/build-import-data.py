#!/usr/bin/env python3
"""
Build import data from a Shopify product CSV export.

What it does
------------
1. Parses the Shopify CSV (one product per Handle, with extra rows for images).
2. Downloads every product image, converts it to WebP, and saves it to
   ../../zero-waste/public/products/<handle>/<n>.webp
3. Picks a category for each product:
     a. Use the leaf of the Shopify "Product Category" column when present
        and meaningful.
     b. Otherwise, infer one from the product title / vendor.
4. Writes a normalized JSON file (./products-import.json) that the Medusa
   import script consumes.

Run
---
    cd zero-waste-backend
    python3 scripts/build-import-data.py [--csv PATH] [--limit N] [--skip-images]

Output
------
- products-import.json next to this script
- WebP images under zero-waste/public/products/<handle>/

Idempotent: re-running overwrites JSON and re-downloads only missing images.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip3 install Pillow")

import urllib.request
import urllib.error


# ─── Paths ─────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parent
REPO_ROOT = BACKEND_ROOT.parent
STOREFRONT_PUBLIC = REPO_ROOT / "zero-waste" / "public" / "products"
DEFAULT_CSV = Path("/Users/jonathanmohon/Downloads/products_export_1.csv")
OUTPUT_JSON = SCRIPT_DIR / "products-import.json"


# ─── Category normalization ────────────────────────────────────────────────
# Final flat category list. Keep these short and storefront-friendly.
CATEGORIES = [
    "Bar Soap",
    "Bath & Body",
    "Skin Care",
    "Hair Care",
    "Combs & Brushes",
    "Oral Care",
    "Food Wraps",
    "Kitchen",
    "Home & Decor",
    "Other",
]

# Map a Shopify leaf category → our flat category
SHOPIFY_LEAF_MAP = {
    "Bar Soap": "Bar Soap",
    "Bath & Body": "Bath & Body",
    "Skin Care": "Skin Care",
    "Cosmetics": "Skin Care",
    "Shampoo & Conditioner Sets": "Hair Care",
    "Combs & Brushes": "Combs & Brushes",
    "Hairbrushes & Combs": "Combs & Brushes",
    "Oral Care": "Oral Care",
    "Tongue Scrapers": "Oral Care",
    "Food Wraps": "Food Wraps",
    "Food, Beverages & Tobacco": "Kitchen",
    "Decor": "Home & Decor",
    # Generic parents fall through to title-based inference
    "Personal Care": None,
    "Health & Beauty": None,
    "Uncategorized": None,
}

# Vendor → category fallback (covers most uncategorized products)
VENDOR_MAP = {
    "Maui Soap Co.": "Bar Soap",
    "SARATOGA SOAP COMPANY": "Bar Soap",
    "Little Seed Farm": "Bar Soap",
    "HiBAR": "Hair Care",
    "Brush With Bamboo": "Oral Care",
    "Huppy": "Oral Care",
    "Bee's Wrap": "Food Wraps",
    "Earth Harbor Naturals": "Skin Care",
    "Blue Heron Botanicals": "Skin Care",
    "Elegant of Essence": "Bath & Body",
    "No Tox Life": "Bath & Body",
    "Refinement House": "Skin Care",
}

# Title keyword inference (last-resort)
TITLE_PATTERNS = [
    (re.compile(r"\b(soap|cold process)\b", re.I), "Bar Soap"),
    (re.compile(r"\b(shampoo|conditioner)\b", re.I), "Hair Care"),
    (re.compile(r"\b(toothbrush|toothpaste|tongue|floss|dental)\b", re.I), "Oral Care"),
    (re.compile(r"\b(comb|hair brush|hairbrush)\b", re.I), "Combs & Brushes"),
    (re.compile(r"\b(wrap|beeswax)\b", re.I), "Food Wraps"),
    (re.compile(r"\b(moistur|serum|cream|face|facial|lotion|oil|balm)\b", re.I), "Skin Care"),
    (re.compile(r"\b(scrub|bath|body|deodorant)\b", re.I), "Bath & Body"),
]


def infer_category(shopify_cat: str, vendor: str, title: str) -> str:
    """Pick a flat category for a product using a 3-tier fallback."""
    # 1. Shopify leaf
    if shopify_cat:
        leaf = shopify_cat.split(">")[-1].strip()
        mapped = SHOPIFY_LEAF_MAP.get(leaf, "MISS")
        if mapped:  # explicit mapping
            return mapped
        if mapped is None and leaf in SHOPIFY_LEAF_MAP:
            # Generic parent — fall through
            pass

    # 2. Vendor
    if vendor and vendor in VENDOR_MAP:
        return VENDOR_MAP[vendor]

    # 3. Title keywords
    for pattern, cat in TITLE_PATTERNS:
        if pattern.search(title):
            return cat

    return "Other"


# ─── Image download + webp conversion ──────────────────────────────────────
def slugify_segment(value: str) -> str:
    """Make a URL/filesystem-safe slug. Collapses runs of dashes."""
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-").lower()
    return value or "product"


def download_image(url: str, dest_jpg: Path) -> bool:
    """Download an image to a temp file. Returns True on success."""
    if dest_jpg.exists():
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "zw-import/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        dest_jpg.parent.mkdir(parents=True, exist_ok=True)
        dest_jpg.write_bytes(data)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  ! download failed: {url} ({e})", file=sys.stderr)
        return False


def to_webp(src_bytes: bytes, dest_webp: Path, max_dim: int = 1600, quality: int = 82) -> bool:
    """Convert image bytes → WebP, capped at max_dim on the long edge."""
    try:
        img = Image.open(io.BytesIO(src_bytes))
        # Drop alpha for JPEGs that come back as RGBA after open
        if img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Cap dimensions
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)

        dest_webp.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_webp, format="WEBP", quality=quality, method=6)
        return True
    except Exception as e:
        print(f"  ! webp convert failed: {dest_webp.name} ({e})", file=sys.stderr)
        return False


def fetch_and_convert(url: str, dest_webp: Path) -> bool:
    """Download + convert in one step. Skips work if dest already exists."""
    if dest_webp.exists():
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "zw-import/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
    except Exception as e:
        print(f"  ! download failed: {url} ({e})", file=sys.stderr)
        return False
    return to_webp(data, dest_webp)


# ─── HTML cleanup ──────────────────────────────────────────────────────────
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def html_to_text(html: str) -> str:
    """Strip Shopify HTML descriptions to plain text. Keeps paragraph breaks."""
    if not html:
        return ""
    text = re.sub(r"</p>|<br\s*/?>|</li>", "\n", html, flags=re.I)
    text = TAG_RE.sub("", text)
    # Decode common entities (&amp; etc.)
    import html as html_mod
    text = html_mod.unescape(text)
    # Collapse runs of whitespace except newlines
    lines = [WS_RE.sub(" ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if l).strip()


# ─── Price parsing ─────────────────────────────────────────────────────────
def parse_cents(value: str) -> int | None:
    """'34.99' → 3499. Returns None if value is empty/invalid."""
    if not value:
        return None
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return None


# ─── Main ──────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--limit", type=int, default=0, help="Process only first N products (debugging)")
    ap.add_argument("--skip-images", action="store_true", help="Skip image download/convert")
    args = ap.parse_args()

    if not args.csv.exists():
        sys.exit(f"CSV not found: {args.csv}")

    print(f"Reading {args.csv}")
    with args.csv.open() as f:
        rows = list(csv.DictReader(f))

    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        h = (r.get("Handle") or "").strip()
        if h:
            grouped[h].append(r)

    handles = list(grouped.keys())
    if args.limit:
        handles = handles[: args.limit]
    print(f"Found {len(handles)} unique products ({len(rows)} rows total)")

    products_out = []
    category_set = set()
    seen_skus: set[str] = set()

    for idx, handle in enumerate(handles, start=1):
        product_rows = grouped[handle]
        primary = product_rows[0]
        title = (primary.get("Title") or "").strip()
        vendor = (primary.get("Vendor") or "").strip()
        shopify_cat = (primary.get("Product Category") or "").strip()
        body_html = primary.get("Body (HTML)") or ""
        description = html_to_text(body_html)
        status = (primary.get("Status") or "draft").strip().lower()
        published = (primary.get("Published") or "").strip().lower() == "true"
        tags = [t.strip() for t in (primary.get("Tags") or "").split(",") if t.strip()]
        sku_raw = (primary.get("Variant SKU") or "").strip().lstrip("'")
        # Some Shopify UPCs were exported as scientific notation (e.g.
        # '8.50083E+11'), which collides across products. Reject anything
        # that looks like scientific notation and fall back to a handle SKU.
        if not sku_raw or re.fullmatch(r"\d+(\.\d+)?[eE][+-]?\d+", sku_raw):
            sku_raw = ""
        price = parse_cents(primary.get("Variant Price") or "")
        compare_at = parse_cents(primary.get("Variant Compare At Price") or "")
        weight_g = primary.get("Variant Grams") or "0"
        try:
            weight = int(weight_g)
        except ValueError:
            weight = 0
        inventory_qty = primary.get("Variant Inventory Qty") or "0"
        try:
            inventory = max(int(inventory_qty), 0)
        except ValueError:
            inventory = 0

        category = infer_category(shopify_cat, vendor, title)
        category_set.add(category)

        # Collect unique image URLs in CSV order
        image_urls: list[str] = []
        seen = set()
        for r in product_rows:
            url = (r.get("Image Src") or "").strip()
            if url and url not in seen:
                seen.add(url)
                image_urls.append(url)

        # Download + convert each image to webp
        rel_image_paths: list[str] = []
        if not args.skip_images and image_urls:
            handle_dir = STOREFRONT_PUBLIC / slugify_segment(handle)
            print(f"[{idx}/{len(handles)}] {handle} — {len(image_urls)} image(s)")
            for n, url in enumerate(image_urls, start=1):
                dest = handle_dir / f"{n}.webp"
                if fetch_and_convert(url, dest):
                    rel_image_paths.append(f"/products/{slugify_segment(handle)}/{n}.webp")
                # Tiny delay to be polite to Shopify CDN
                if n % 10 == 0:
                    time.sleep(0.2)
        elif image_urls:
            handle_slug = slugify_segment(handle)
            for n in range(1, len(image_urls) + 1):
                rel_image_paths.append(f"/products/{handle_slug}/{n}.webp")

        # Use the slugified handle everywhere — both as the Medusa product
        # handle and as the on-disk image directory. The raw Shopify handle
        # may contain characters Medusa rejects (e.g. '®').
        safe_handle = slugify_segment(handle)

        # Disambiguate duplicate SKUs (Shopify exports occasionally collide).
        sku = (sku_raw or f"ZW-{safe_handle.upper()}")[:60]
        if sku in seen_skus:
            sku = f"ZW-{safe_handle.upper()}"[:60]
            n = 2
            while sku in seen_skus:
                sku = f"ZW-{safe_handle.upper()[:54]}-{n}"
                n += 1
        seen_skus.add(sku)

        products_out.append({
            "handle": safe_handle,
            "title": title,
            "description": description,
            "vendor": vendor,
            "category": category,
            "status": "published" if (status == "active" or published) else "draft",
            "tags": tags,
            "sku": sku,
            "price": price or 0,
            "compare_at_price": compare_at,
            "weight": weight,
            "inventory": inventory,
            "thumbnail": rel_image_paths[0] if rel_image_paths else None,
            "images": rel_image_paths,
        })

    out = {
        "categories": sorted(category_set),
        "products": products_out,
    }
    OUTPUT_JSON.write_text(json.dumps(out, indent=2))
    print(f"\nWrote {OUTPUT_JSON}")
    print(f"  {len(products_out)} products across {len(category_set)} categories: {sorted(category_set)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
