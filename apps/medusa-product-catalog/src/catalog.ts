export type ProductStatus = "draft" | "proposed" | "published" | "rejected"

export type ProductImage = { id?: string; url: string; rank?: number }
export type ProductOption = { id?: string; title: string; values: string[] }
export type ProductVariant = {
  id: string
  title: string
  sku?: string | null
  options?: Record<string, string> | Array<{ id: string; value: string }>
  prices?: Array<{ id?: string; currency_code: string; amount: number }>
  manage_inventory?: boolean
}
export type Product = {
  id: string
  title: string
  subtitle?: string | null
  handle: string
  description?: string | null
  status: ProductStatus
  thumbnail?: string | null
  images?: ProductImage[]
  options?: ProductOption[]
  variants?: ProductVariant[]
  material?: string | null
  origin_country?: string | null
  hs_code?: string | null
  mid_code?: string | null
  weight?: number | null
  length?: number | null
  width?: number | null
  height?: number | null
  collection_id?: string | null
  type_id?: string | null
  categories?: Array<{ id: string; name: string }>
  tags?: Array<{ id: string; value: string }>
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export type ProductListResponse = {
  products: Product[]
  count: number
  limit: number
  offset: number
}

export type AgentProfile = {
  readiness: number
  buyer: string
  useCases: string[]
  sellingPoints: string[]
  missing: string[]
  lastReviewed: string
}

const DEMO_PRODUCTS: Product[] = [
  {
    id: "demo-rayon-01",
    title: "Printed Rayon Voile 120 GSM",
    subtitle: "145 cm · soft handfeel · reactive print",
    handle: "printed-rayon-voile-120gsm",
    description: "Lightweight printed rayon/viscose fabric for resort shirts, dresses and relaxed womenswear.",
    status: "draft",
    thumbnail: "swatch-a",
    images: [{ url: "swatch-a" }, { url: "swatch-b" }, { url: "swatch-c" }],
    options: [{ title: "Colorway", values: ["Ivory", "Blue", "Olive"] }],
    variants: [
      { id: "v1", title: "Ivory", sku: "RV120-IVORY", options: { Colorway: "Ivory" }, prices: [{ currency_code: "usd", amount: 215 }], manage_inventory: false },
      { id: "v2", title: "Blue", sku: "RV120-BLUE", options: { Colorway: "Blue" }, prices: [{ currency_code: "usd", amount: 220 }], manage_inventory: false },
      { id: "v3", title: "Olive", sku: "RV120-OLIVE", options: { Colorway: "Olive" }, prices: [{ currency_code: "usd", amount: 225 }], manage_inventory: false }
    ],
    material: "Rayon / Viscose",
    origin_country: "China",
    categories: [{ id: "cat-fabric", name: "Fabrics" }],
    tags: [{ id: "tag-lightweight", value: "lightweight" }, { id: "tag-resort", value: "resortwear" }],
    metadata: { catalog: { buyer: "US apparel brands & distributors", use_cases: ["resortwear", "womenswear"], readiness: 92 } },
    created_at: "2026-10-12T08:30:00Z",
    updated_at: "2026-10-15T11:20:00Z"
  },
  {
    id: "demo-knit-02",
    title: "Cotton Modal Rib 220 GSM",
    subtitle: "4-way stretch · compact surface",
    handle: "cotton-modal-rib-220gsm",
    description: "Compact rib knit for basics, fitted tops and athleisure programs.",
    status: "published",
    thumbnail: "swatch-d",
    images: [{ url: "swatch-d" }, { url: "swatch-e" }],
    options: [{ title: "Color", values: ["Black", "Stone"] }],
    variants: [
      { id: "v4", title: "Black", sku: "CMR220-BLK", options: { Color: "Black" }, prices: [{ currency_code: "usd", amount: 340 }], manage_inventory: true },
      { id: "v5", title: "Stone", sku: "CMR220-STN", options: { Color: "Stone" }, prices: [{ currency_code: "usd", amount: 350 }], manage_inventory: true }
    ],
    material: "Cotton / Modal",
    origin_country: "China",
    categories: [{ id: "cat-knit", name: "Knits" }],
    tags: [{ id: "tag-basics", value: "basics" }],
    metadata: { catalog: { buyer: "US fashion distributors", use_cases: ["basics", "athleisure"], readiness: 78 } },
    created_at: "2026-09-28T04:10:00Z",
    updated_at: "2026-10-10T16:40:00Z"
  },
  {
    id: "demo-linen-03",
    title: "Washed Linen Blend 165 GSM",
    subtitle: "Natural texture · breathable",
    handle: "washed-linen-blend-165gsm",
    description: "Washed linen blend with a dry, natural surface for shirts, resort sets and home textile capsules.",
    status: "draft",
    thumbnail: "swatch-f",
    images: [{ url: "swatch-f" }, { url: "swatch-g" }],
    options: [{ title: "Color", values: ["Natural", "Charcoal"] }],
    variants: [
      { id: "v6", title: "Natural", sku: "WLB165-NAT", options: { Color: "Natural" }, prices: [{ currency_code: "usd", amount: 305 }], manage_inventory: false },
      { id: "v7", title: "Charcoal", sku: "WLB165-CHA", options: { Color: "Charcoal" }, prices: [{ currency_code: "usd", amount: 320 }], manage_inventory: false }
    ],
    material: "Linen / Viscose",
    origin_country: "China",
    categories: [{ id: "cat-fabric", name: "Fabrics" }],
    tags: [{ id: "tag-natural", value: "natural-texture" }],
    metadata: { catalog: { buyer: "Resortwear importers", use_cases: ["shirts", "resort-sets"], readiness: 61 } },
    created_at: "2026-10-04T09:00:00Z",
    updated_at: "2026-10-14T06:25:00Z"
  }
]

export const demoAgentProfiles: Record<string, AgentProfile> = {
  "demo-rayon-01": {
    readiness: 92,
    buyer: "US apparel brands & distributors",
    useCases: ["Resortwear", "Womenswear", "Lightweight shirts"],
    sellingPoints: ["120 GSM / 145 cm", "Trial order supported", "Reactive printing"],
    missing: ["Approved compliance PDF"],
    lastReviewed: "2026-10-15"
  },
  "demo-knit-02": {
    readiness: 78,
    buyer: "US fashion distributors",
    useCases: ["Basics", "Athleisure"],
    sellingPoints: ["220 GSM", "4-way stretch", "Stable repeat program"],
    missing: ["Distributor policy", "MOQ evidence"],
    lastReviewed: "2026-10-10"
  },
  "demo-linen-03": {
    readiness: 61,
    buyer: "Resortwear importers",
    useCases: ["Shirts", "Resort sets"],
    sellingPoints: ["Natural texture", "Breathable", "165 GSM"],
    missing: ["Test report", "MOQ", "Lead time"],
    lastReviewed: "2026-10-14"
  }
}

export function demoProducts(): Product[] {
  const stored = localStorage.getItem("medusa-catalog-demo-products")
  if (!stored) return DEMO_PRODUCTS
  try { return JSON.parse(stored) as Product[] } catch { return DEMO_PRODUCTS }
}

export function saveDemoProducts(products: Product[]) {
  localStorage.setItem("medusa-catalog-demo-products", JSON.stringify(products))
}

export class MedusaClient {
  private token: string | null = null
  constructor(private readonly baseUrl = "") {}

  get authenticated() { return Boolean(this.token) }

  async login(email: string, password: string) {
    const response = await fetch(this.baseUrl + "/auth/user/emailpass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    })
    const body = await parseResponse(response)
    if (!response.ok || typeof body?.token !== "string") throw new Error(body?.message || "登录失败")
    this.token = body.token
    return body.token
  }

  logout() { this.token = null }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      ...init,
      credentials: "include",
      headers: {
        ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {})
      }
    })
    const body = await parseResponse(response)
    if (!response.ok) throw new Error(body?.message || body?.type || "Medusa API 请求失败")
    return body as T
  }

  listProducts(params: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams({
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0),
      order: "-updated_at",
      fields: "id,title,subtitle,handle,status,thumbnail,images,variants,categories,tags,collection_id,metadata,updated_at",
      ...(params.q ? { q: params.q } : {}),
      ...(params.status ? { status: params.status } : {})
    })
    return this.request<ProductListResponse>("/admin/products?" + query)
  }

  retrieveProduct(id: string) {
    return this.request<{ product: Product }>(
      "/admin/products/" + encodeURIComponent(id) +
      "?fields=id,title,subtitle,handle,status,description,thumbnail,images,options,variants,material,origin_country,hs_code,mid_code,weight,length,width,height,collection_id,type_id,categories,tags,metadata,created_at,updated_at"
    )
  }

  createProduct(input: Record<string, unknown>) {
    return this.request<{ product: Product }>("/admin/products", { method: "POST", body: JSON.stringify(input) })
  }

  updateProduct(id: string, input: Record<string, unknown>) {
    return this.request<{ product: Product }>("/admin/products/" + encodeURIComponent(id), { method: "POST", body: JSON.stringify(input) })
  }
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { message: text } }
}
