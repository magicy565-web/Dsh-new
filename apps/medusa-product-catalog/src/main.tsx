import { useEffect, useMemo, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { demoAgentProfiles, demoProducts, MedusaClient, saveDemoProducts, type AgentProfile, type Product, type ProductStatus } from "./catalog"
import "./styles.css"

type Mode = "demo" | "live"
type Nav = "products" | "collections" | "categories" | "agent"
const statusLabel: Record<ProductStatus, string> = { draft: "草稿", proposed: "待审核", published: "已发布", rejected: "已拒绝" }

function App() {
  const [mode, setMode] = useState<Mode>(() => localStorage.getItem("catalog-mode") === "live" ? "live" : "demo")
  const [nav, setNav] = useState<Nav>("products")
  const [products, setProducts] = useState<Product[]>(() => demoProducts())
  const [selected, setSelected] = useState<Product | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | ProductStatus>("all")
  const [editor, setEditor] = useState<"new" | "edit" | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [liveClient] = useState(() => new MedusaClient(import.meta.env.VITE_MEDUSA_BASE_URL || ""))
  const [liveError, setLiveError] = useState("")
  const [toast, setToast] = useState("")
  const [authVersion, setAuthVersion] = useState(0)

  useEffect(() => { localStorage.setItem("catalog-mode", mode) }, [mode])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(""), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (mode !== "live" || !liveClient.authenticated) return
    liveClient.listProducts({ q: query, status: status === "all" ? undefined : status }).then(r => {
      setProducts(r.products)
      setLiveError("")
    }).catch(e => setLiveError(e instanceof Error ? e.message : "无法读取 Medusa"))
  }, [mode, query, status, liveClient, authVersion])

  const filtered = useMemo(() => {
    if (mode === "live") return products
    const q = query.trim().toLowerCase()
    return products.filter(p =>
      (!q || [p.title, p.subtitle, p.handle, p.description, p.material].join(" ").toLowerCase().includes(q)) &&
      (status === "all" || p.status === status)
    )
  }, [mode, products, query, status])

  function selectProduct(product: Product) { setSelected(product); setEditor(null); setMobileMenu(false) }
  function createProduct() {
    setSelected({ id: "", title: "", subtitle: "", handle: "", description: "", status: "draft", images: [], options: [], variants: [], metadata: {} })
    setEditor("new")
  }
  function saveProduct(next: Product) {
    if (mode === "demo") {
      const nextList = next.id
        ? products.map(p => p.id === next.id ? next : p)
        : [{ ...next, id: "demo-" + Date.now() }, ...products]
      setProducts(nextList)
      saveDemoProducts(nextList)
      setSelected(next.id ? next : nextList[0])
      setEditor(null)
      setToast("产品已保存")
      return
    }
    const payload = pickWritable(next)
    const request = next.id ? liveClient.updateProduct(next.id, payload) : liveClient.createProduct(payload)
    request.then(r => {
      const product = r.product
      setProducts(current => next.id ? current.map(p => p.id === next.id ? product : p) : [product, ...current])
      setSelected(product)
      setEditor(null)
      setToast("Medusa 产品已保存")
      setLiveError("")
    }).catch(e => setLiveError(e instanceof Error ? e.message : "保存失败"))
  }
  function publishProduct(product: Product) {
    if (product.status === "published") return
    if (mode === "demo") {
      const next = { ...product, status: "published" as const }
      saveProduct(next)
      setSelected(next)
      return
    }
    liveClient.updateProduct(product.id, { status: "published" }).then(r => {
      setSelected(r.product)
      setProducts(current => current.map(p => p.id === r.product.id ? r.product : p))
      setToast("产品已发布")
    }).catch(e => setLiveError(e instanceof Error ? e.message : "发布失败"))
  }

  const agentProfile = selected ? agentProfileFor(selected) : undefined

  return <div className="shell">
    <aside className={"sidebar " + (mobileMenu ? "open" : "")}>
      <div className="brand"><span className="brand-mark">P</span><div><strong>Product</strong><small>Catalog</small></div></div>
      <div className="workspace-chip"><span className="status-dot" />{mode === "demo" ? "离线预览" : "Medusa v2"}</div>
      <nav>
        <button className={nav === "products" ? "active" : ""} onClick={() => { setNav("products"); setSelected(null) }}><Icon name="box" />产品</button>
        <button className={nav === "collections" ? "active" : ""} onClick={() => setNav("collections")}><Icon name="grid" />系列</button>
        <button className={nav === "categories" ? "active" : ""} onClick={() => setNav("categories")}><Icon name="folder" />分类</button>
        <button className={nav === "agent" ? "active" : ""} onClick={() => setNav("agent")}><Icon name="spark" />Agent 数据</button>
      </nav>
      <div className="sidebar-bottom">
        <button className="mode-switch" onClick={() => setMode(mode === "demo" ? "live" : "demo")}><span>{mode === "demo" ? "切换到真实 Medusa" : "切回离线预览"}</span><Icon name="arrow" /></button>
        <p>独立应用 · 不依赖 Workspace</p>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileMenu(v => !v)} aria-label="菜单"><Icon name="menu" /></button>
        <div className="breadcrumbs"><span>产品库</span>{selected && <><i>/</i><strong>{selected.title || "新产品"}</strong></>}</div>
        <div className="top-actions">
          <span className={"mode-pill " + mode}><span />{mode === "demo" ? "Preview" : "Live"}</span>
          <button className="icon-button" onClick={() => setToast("这是独立产品库，不连接 Workspace")} aria-label="帮助"><Icon name="info" /></button>
        </div>
      </header>

      {nav === "products" && mode === "live" && !liveClient.authenticated
        ? <LoginPanel client={liveClient} onSuccess={() => { setAuthVersion(v => v + 1); setToast("已连接 Medusa"); }} />
        : null}
      {nav === "products" && !(mode === "live" && !liveClient.authenticated) && !selected &&
        <ProductList products={filtered} query={query} setQuery={setQuery} status={status} setStatus={setStatus} onSelect={selectProduct} onCreate={createProduct} mode={mode} error={liveError} />}
      {nav === "products" && selected &&
        <ProductDetail product={selected} agentProfile={agentProfile} onBack={() => setSelected(null)} onEdit={() => setEditor("edit")} onPublish={() => publishProduct(selected)} />}
      {nav === "collections" && <Placeholder title="系列" description="Medusa 原生 Collections 负责核心数据；这里暂不复制电商逻辑，只保留企业真正需要的产品组织体验。" />}
      {nav === "categories" && <Placeholder title="分类" description="Medusa 原生 Product Categories 支持层级分类；这里提供更轻、更适合移动端的浏览方式。" />}
      {nav === "agent" && <AgentOverview products={products} onSelect={selectProduct} />}
      {editor && selected && <Editor product={selected} mode={mode} onClose={() => setEditor(null)} onSave={saveProduct} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  </div>
}

function LoginPanel({ client, onSuccess }: { client: MedusaClient; onSuccess: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError("")
    try { await client.login(email, password); onSuccess() }
    catch (e) { setError(e instanceof Error ? e.message : "登录失败") }
    finally { setBusy(false) }
  }
  return <section className="login-page">
    <div className="login-card">
      <span className="eyebrow">MEDUSA V2 · LIVE</span>
      <h1>连接产品库</h1>
      <p>使用 Medusa 管理员账号登录。JWT 只保存在当前浏览器内存，不把 Secret API Key 放进前端。</p>
      <form onSubmit={submit}>
        <Field label="管理员邮箱"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" placeholder="admin@example.com" /></Field>
        <Field label="密码"><input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {error && <div className="form-error">{error}</div>}
        <button className="primary full" disabled={busy}>{busy ? "正在连接…" : "连接 Medusa"}</button>
      </form>
      <p className="login-note">如果没有运行 Medusa，切回 Preview 即可继续设计和测试，不需要任何服务器。</p>
    </div>
  </section>
}

function ProductList({ products, query, setQuery, status, setStatus, onSelect, onCreate, mode, error }: {
  products: Product[]; query: string; setQuery: (v: string) => void; status: "all" | ProductStatus; setStatus: (v: "all" | ProductStatus) => void; onSelect: (p: Product) => void; onCreate: () => void; mode: Mode; error: string
}) {
  const draft = products.filter(p => p.status === "draft").length
  const published = products.filter(p => p.status === "published").length
  return <section className="page">
    <div className="page-head">
      <div><span className="eyebrow">PRODUCTS</span><h1>产品</h1><p>产品身份、规格、状态和 Agent 上下文放在同一个经营对象里。</p></div>
      <button className="primary" onClick={onCreate}><Icon name="plus" />新建产品</button>
    </div>
    <div className="metric-row">
      <Metric label="全部产品" value={products.length} />
      <Metric label="草稿" value={draft} />
      <Metric label="已发布" value={published} />
      <Metric label="Agent 就绪" value={products.filter(p => readinessFor(p) >= 80).length} />
    </div>
    <div className="toolbar">
      <label className="search"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称、材质、Handle…" /></label>
      <div className="segmented">
        {(["all", "draft", "published", "proposed"] as const).map(s => <button key={s} className={status === s ? "selected" : ""} onClick={() => setStatus(s)}>{s === "all" ? "全部" : statusLabel[s]}</button>)}
      </div>
    </div>
    {mode === "live" && error && <div className="error-banner"><Icon name="alert" /><div><strong>Medusa 暂时不可用</strong><span>{error}</span></div></div>}
    <div className="product-grid">{products.map(product => <ProductCard key={product.id} product={product} onClick={() => onSelect(product)} />)}</div>
    {!products.length && <div className="empty"><span>⌘</span><h3>没有匹配的产品</h3><p>换一个关键词，或者先创建第一个产品。</p></div>}
  </section>
}

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  const readiness = readinessFor(product)
  return <button className="product-card" onClick={onClick}>
    <div className={"product-art " + (typeof product.thumbnail === "string" ? product.thumbnail : "swatch-a")}><span>{product.title.slice(0, 2)}</span></div>
    <div className="card-body">
      <div className="card-line"><span className={"status " + product.status}>{statusLabel[product.status]}</span><span className="readiness">{readiness}% ready</span></div>
      <h3>{product.title}</h3>
      <p>{product.subtitle || product.description || "暂无产品简介"}</p>
      <div className="card-meta"><span>{product.material || "未填写材质"}</span><span>{product.variants?.length || 0} variants</span></div>
    </div>
  </button>
}

function ProductDetail({ product, agentProfile, onBack, onEdit, onPublish }: {
  product: Product; agentProfile?: AgentProfile; onBack: () => void; onEdit: () => void; onPublish: () => void
}) {
  const [image, setImage] = useState(0)
  const images = product.images?.length ? product.images : [{ url: product.thumbnail || "swatch-a" }]
  const published = product.status === "published"
  return <section className="detail-page">
    <button className="back-link" onClick={onBack}><Icon name="back" />返回产品</button>
    <div className="detail-head">
      <div><span className={"status " + product.status}>{statusLabel[product.status]}</span><h1>{product.title}</h1><p>{product.subtitle || "未设置副标题"}</p></div>
      <div className="detail-actions"><button className="secondary" onClick={onEdit}>编辑</button>{!published && <button className="primary" onClick={onPublish}>发布</button>}</div>
    </div>
    <div className="detail-layout">
      <div className="visual-column">
        <div className={"hero-art " + imageClass(images[image].url)}><span>{product.title.slice(0, 2)}</span></div>
        <div className="thumbs">{images.map((item, index) => <button key={item.id || index} className={index === image ? "selected" : ""} onClick={() => setImage(index)} aria-label={"图片 " + (index + 1)}><span className={imageClass(item.url)} /></button>)}</div>
      </div>
      <div className="content-column">
        <InfoCard title="产品信息"><Info label="Handle" value={product.handle || "未设置"} /><Info label="材质" value={product.material || "未填写"} /><Info label="原产地" value={product.origin_country || "未填写"} /><Info label="分类" value={product.categories?.map(c => c.name).join(", ") || "未分类"} /></InfoCard>
        <InfoCard title="描述"><p className="long-copy">{product.description || "暂无描述"}</p></InfoCard>
        <InfoCard title="Variants"><div className="variant-list">{(product.variants || []).map(v => <div className="variant" key={v.id}><div><strong>{v.title}</strong><small>{v.sku || "无 SKU"}</small></div><span>{formatPrice(v.prices?.[0])}</span></div>)}{!product.variants?.length && <p className="muted">暂无 variants</p>}</div></InfoCard>
        {agentProfile && <AgentCard profile={agentProfile} />}
      </div>
    </div>
  </section>
}

function AgentCard({ profile }: { profile: AgentProfile }) {
  return <div className="agent-card">
    <div className="agent-head"><div><span className="eyebrow">AI CONTEXT</span><h3>Agent 可用度</h3></div><strong>{profile.readiness}%</strong></div>
    <div className="progress"><span style={{ width: profile.readiness + "%" }} /></div>
    <div className="agent-grid"><div><small>目标买家</small><strong>{profile.buyer}</strong></div><div><small>最后审核</small><strong>{profile.lastReviewed}</strong></div></div>
    <div className="chip-row">{profile.useCases.map(x => <span key={x}>{x}</span>)}</div>
    <div className="agent-section"><small>销售要点</small><ul>{profile.sellingPoints.map(x => <li key={x}>{x}</li>)}</ul></div>
    {!!profile.missing.length && <div className="missing"><Icon name="alert" /><div><strong>还缺 {profile.missing.length} 项资料</strong><span>{profile.missing.join(" · ")}</span></div></div>}
  </div>
}

function AgentOverview({ products, onSelect }: { products: Product[]; onSelect: (p: Product) => void }) {
  const ranked = [...products].sort((a, b) => readinessFor(b) - readinessFor(a))
  const avg = Math.round(products.reduce((sum, p) => sum + readinessFor(p), 0) / Math.max(1, products.length))
  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">AGENT DATA</span><h1>Agent 数据</h1><p>不是另一个知识库，而是让业务 Agent 判断“这个产品能不能拿去做业务”的结构化上下文。</p></div></div>
    <div className="agent-overview">
      <div className="agent-hero"><span className="eyebrow">CATALOG QUALITY</span><strong>{avg}%</strong><p>平均产品经营就绪度</p></div>
      <div className="agent-hero"><span className="eyebrow">READY TO USE</span><strong>{products.filter(p => readinessFor(p) >= 80).length}</strong><p>可直接进入业务 Agent</p></div>
      <div className="agent-hero"><span className="eyebrow">NEEDS WORK</span><strong>{products.filter(p => readinessFor(p) < 70).length}</strong><p>资料缺口需要补齐</p></div>
    </div>
    <div className="ranking">{ranked.map(p => <button key={p.id} onClick={() => onSelect(p)}><div className={"mini-art " + (typeof p.thumbnail === "string" ? p.thumbnail : "swatch-a")} /><div><strong>{p.title}</strong><small>{p.material || "未填写材质"}</small></div><span>{readinessFor(p)}%</span><Icon name="chevron" /></button>)}</div>
  </section>
}

function Editor({ product, mode, onClose, onSave }: { product: Product; mode: Mode; onClose: () => void; onSave: (p: Product) => void }) {
  const [draft, setDraft] = useState<Product>({ ...product })
  function update<K extends keyof Product>(key: K, value: Product[K]) { setDraft(current => ({ ...current, [key]: value })) }
  function submit(e: FormEvent) { e.preventDefault(); if (!draft.title.trim()) return; onSave(draft) }
  return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <form className="drawer" onSubmit={submit}>
      <header><div><span className="eyebrow">{product.id ? "EDIT PRODUCT" : "NEW PRODUCT"}</span><h2>{product.id ? "编辑产品" : "新建产品"}</h2></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close" /></button></header>
      <div className="drawer-scroll">
        <Field label="产品名称"><input autoFocus value={draft.title} onChange={e => update("title", e.target.value)} placeholder="例如 Printed Rayon Voile 120 GSM" /></Field>
        <Field label="副标题"><input value={draft.subtitle || ""} onChange={e => update("subtitle", e.target.value)} placeholder="一句话说明规格或卖点" /></Field>
        <Field label="Handle"><input value={draft.handle} onChange={e => update("handle", e.target.value)} placeholder="printed-rayon-voile-120gsm" /></Field>
        <Field label="产品描述"><textarea rows={7} value={draft.description || ""} onChange={e => update("description", e.target.value)} placeholder="描述产品、应用和客户价值…" /></Field>
        <div className="form-grid"><Field label="材质"><input value={draft.material || ""} onChange={e => update("material", e.target.value)} /></Field><Field label="原产地"><input value={draft.origin_country || ""} onChange={e => update("origin_country", e.target.value)} /></Field></div>
        <Field label="状态"><select value={draft.status} onChange={e => update("status", e.target.value as ProductStatus)}><option value="draft">草稿</option><option value="proposed">待审核</option><option value="published">已发布</option><option value="rejected">已拒绝</option></select></Field>
        <div className="editor-note"><Icon name="spark" /><div><strong>Agent 数据独立于 Commerce Product</strong><p>买家、应用场景、销售要点、证据和资料缺口后续进入独立 Product Context 模块，不把业务判断塞进 Medusa 原生字段。</p></div></div>
        {mode === "live" && <div className="editor-note neutral"><Icon name="shield" /><div><strong>真实 Medusa</strong><p>浏览器只使用当前管理员 JWT，不保存 Secret API Key。</p></div></div>}
      </div>
      <footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" type="submit">保存产品</button></footer>
    </form>
  </div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function InfoCard({ title, children }: { title: string; children: ReactNode }) { return <section className="info-card"><header><h3>{title}</h3><Icon name="dots" /></header>{children}</section> }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-line"><span>{label}</span><strong>{value}</strong></div> }
function Placeholder({ title, description }: { title: string; description: string }) { return <section className="placeholder"><span className="eyebrow">MEDUSA CORE</span><h1>{title}</h1><p>{description}</p></section> }

function agentProfileFor(product: Product): AgentProfile | undefined {
  const demo = demoAgentProfiles[product.id]
  if (demo) return demo
  const catalog = product.metadata?.catalog
  if (!catalog || typeof catalog !== "object") return undefined
  const value = catalog as Record<string, unknown>
  return {
    readiness: typeof value.readiness === "number" ? value.readiness : readinessFor(product),
    buyer: typeof value.buyer === "string" ? value.buyer : "尚未定义目标买家",
    useCases: Array.isArray(value.use_cases) ? value.use_cases.filter((x): x is string => typeof x === "string") : [],
    sellingPoints: Array.isArray(value.selling_points) ? value.selling_points.filter((x): x is string => typeof x === "string") : [],
    missing: Array.isArray(value.missing) ? value.missing.filter((x): x is string => typeof x === "string") : ["尚未建立 Product Context"],
    lastReviewed: typeof value.last_reviewed === "string" ? value.last_reviewed : "未审核"
  }
}

function readinessFor(product: Product) {
  const profile = demoAgentProfiles[product.id]
  if (profile) return profile.readiness
  const catalog = product.metadata?.catalog
  if (catalog && typeof catalog === "object" && typeof (catalog as Record<string, unknown>).readiness === "number") return Number((catalog as Record<string, unknown>).readiness)
  let score = 40
  if (product.description) score += 15
  if (product.material) score += 10
  if (product.variants?.length) score += 15
  if (product.images?.length) score += 10
  return Math.min(100, score)
}

function formatPrice(price?: { currency_code: string; amount: number }) {
  if (!price) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency_code.toUpperCase() }).format(price.amount / 100)
}

function pickWritable(product: Product): Record<string, unknown> {
  return {
    title: product.title,
    subtitle: product.subtitle || undefined,
    handle: product.handle || undefined,
    description: product.description || undefined,
    material: product.material || undefined,
    origin_country: product.origin_country || undefined,
    status: product.status,
    metadata: product.metadata || {}
  }
}

function imageClass(value: string) { return value.startsWith("swatch-") ? value : "swatch-a" }

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    box: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="m3 9 9 4 9-4"/><path d="M12 13v7"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></>,
    spark: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/><path d="m19 16 .7 2.3L22 19l-2.3.7z"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    alert: <><path d="m12 3 9 17H3z"/><path d="M12 9v4M12 17h.01"/></>,
    back: <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    dots: <><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.3 8.1-8 10-4.7-1.9-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
