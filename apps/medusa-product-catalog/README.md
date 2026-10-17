# Standalone Medusa Product Catalog

This application is intentionally independent from Workspace Server, Dot, Muse, Shopify and any paused server.

## What it does

- Preview mode: localStorage-backed product and Product Context data. No backend required.
- Live mode: authenticated Medusa v2 Admin API.
- Product CRUD: title, subtitle, handle, description, material, origin, status.
- Bulk operations: publish, draft, delete, collection assignment, category assignment and sales-channel assignment.
- CSV import/export: one catalog schema carries Product, Variant and Agent Context summary fields; export supports all loaded products or the current selection.
- Real product media: browser upload in Preview; /admin/uploads in Live; image order and thumbnail are persisted through Medusa.
- Product Options and Variants: add/remove product options, edit product-specific option values, add/update/delete variants in one batch, and preserve existing variant price records.
- Collections, Categories and Sales Channels: read native Medusa structures and use native product relations for assignments.
- Inventory: read Inventory Items and Stock Locations, then edit stocked quantity per location using Medusa Inventory Level APIs.
- Product Context: separate vertical business data for buyer, markets, use cases, selling points, evidence, commercial policy, missing evidence and Agent summary.
- Agent Data page: ranks products by Product Context readiness when context exists.

## Run

    cd apps/medusa-product-catalog
    npm install
    npm run dev

Without VITE_MEDUSA_BASE_URL, Preview mode works immediately. Live mode can use a local Medusa server through the Vite proxy or a remote Medusa base URL.

## Security

- No Medusa Secret API Key is placed in VITE_ variables.
- Live login obtains a short-lived JWT and keeps it in page memory.
- Requests also include browser credentials for Medusa session authentication.
- Product Context remains under authenticated /admin routes.
- The Agent-facing boundary is intended to expose only approved context in a future read-only worker tool; this UI does not grant Agents Admin credentials.
- Product price amounts follow Medusa v2 semantics: values such as `2.30` mean 2.30 in the currency unit; they are not converted to cents in this UI.

## Architecture

Medusa remains the commerce source for Product, Variant, Option, Image, Collection and Category. Product Context is a separate custom Medusa module linked to Product by a read-only inverse link. The UI is a thin vertical admin experience over those primitives rather than a fork of Medusa Admin.

## Current validation boundary

The repository source is committed, but a real Medusa server is intentionally not running. Browser E2E and Node dependency installation therefore still require an executable environment. Do not claim a live integration test passed until it has been run against a real Medusa instance.
