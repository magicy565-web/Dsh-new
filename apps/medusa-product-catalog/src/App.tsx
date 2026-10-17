import {sanitizeProductDraft as sanitizeDraft} from './product-editor'
import {useEffect,useMemo,useRef,useState} from "react"
import type {ChangeEvent,Dispatch,FormEvent,ReactNode,RefObject,SetStateAction} from "react"
import {
  demoContexts,demoProducts,MedusaClient,saveDemoContexts,saveDemoProducts,
  type CommercialPolicy,type Product,type ProductContext,type ProductImage,
  type ProductOption,type ProductPrice,type ProductStatus,type ProductVariant,type EvidenceItem,type SalesChannel,type InventoryItem,type StockLocation
} from "./catalog"
import {catalogCsv,parseCatalogCsv,type CatalogImportRow} from "./catalogCsv"

const labels:Record<ProductStatus,string>={draft:"草稿",proposed:"待审核",published:"已发布",rejected:"已拒绝"}
const contextLabels:Record<ProductContext["status"],string>={incomplete:"资料不足",ready_for_review:"待审核",approved:"已通过",blocked:"已阻断"}

const previewLocations:StockLocation[]=[{id:"preview-main",name:"Main Warehouse"},{id:"preview-sg",name:"Singapore Hub"}]
const previewInventory:InventoryItem[]=[
  {id:"preview-inv-1",sku:"RV120-IVORY",title:"Printed Rayon Voile · Ivory",stocked_quantity:1200,reserved_quantity:80,available_quantity:1120,location_levels:[{id:"preview-l1",inventory_item_id:"preview-inv-1",location_id:"preview-main",stocked_quantity:1200,reserved_quantity:80,available_quantity:1120,incoming_quantity:300}]},
  {id:"preview-inv-2",sku:"CMR220-BLK",title:"Cotton Modal Rib · Black",stocked_quantity:640,reserved_quantity:40,available_quantity:600,location_levels:[{id:"preview-l2",inventory_item_id:"preview-inv-2",location_id:"preview-main",stocked_quantity:640,reserved_quantity:40,available_quantity:600,incoming_quantity:120}]},
  {id:"preview-inv-3",sku:"WLB165-SAND",title:"Washed Linen Blend · Sand",stocked_quantity:260,reserved_quantity:0,available_quantity:260,location_levels:[{id:"preview-l3",inventory_item_id:"preview-inv-3",location_id:"preview-sg",stocked_quantity:260,reserved_quantity:0,available_quantity:260,incoming_quantity:0}]}
]

type DraftImage=ProductImage & {file?:File}
type DraftProduct=Omit<Product,"images"|"options"|"variants">&{images:DraftImage[];options:ProductOption[];variants:ProductVariant[]}
type EditorSection="details"|"media"|"variants"|"organization"
type BulkAction="publish"|"draft"|"delete"|"collection"|"category"|"sales"

export default function App(){
  const [mode,setMode]=useState<"demo"|"live">("demo")
  const [tab,setTab]=useState<"products"|"collections"|"categories"|"inventory"|"agent">("products")
  const [items,setItems]=useState<Product[]>(()=>demoProducts())
  const [contexts,setContexts]=useState<Record<string,ProductContext>>(()=>demoContexts())
  const [selected,setSelected]=useState<Product|null>(null)
  const [query,setQuery]=useState("")
  const [status,setStatus]=useState<"all"|ProductStatus>("all")
  const [menu,setMenu]=useState(false)
  const [error,setError]=useState("")
  const [toast,setToast]=useState("")
  const [busy,setBusy]=useState(false)
  const [editor,setEditor]=useState<{product:DraftProduct;section:EditorSection}|null>(null)
  const [contextEditor,setContextEditor]=useState<ProductContext|null>(null)
  const [collections,setCollections]=useState<{id:string;title:string;handle:string;products?:{id:string}[]}[]>([])
  const [categories,setCategories]=useState<{id:string;name:string;handle:string;parent_category_id?:string|null;is_active?:boolean}[]>([])
  const [salesChannels,setSalesChannels]=useState<SalesChannel[]>([])
  const [inventoryItems,setInventoryItems]=useState<InventoryItem[]>(()=>previewInventory.map(x=>({...x,location_levels:x.location_levels.map(l=>({...l}))})))
  const [stockLocations,setStockLocations]=useState<StockLocation[]>(()=>previewLocations.map(x=>({...x})))
  const [selectedIds,setSelectedIds]=useState<string[]>([])
  const [bulkOpen,setBulkOpen]=useState(false)
  const [importOpen,setImportOpen]=useState(false)
  const [importRows,setImportRows]=useState<CatalogImportRow[]>([])
  const [client]=useState(()=>new MedusaClient(import.meta.env.VITE_MEDUSA_BASE_URL||""))
  const [auth,setAuth]=useState(0)

  useEffect(()=>{
    if(mode!=="live"||!client.authenticated)return
    client.listProducts(query,status==="all"?undefined:status).then(r=>{setItems(r.products);setError("")}).catch(e=>setError(e instanceof Error?e.message:"Medusa 读取失败"))
    client.listContexts().then(r=>setContexts(Object.fromEntries(r.product_contexts.map(c=>[c.product_id,c])))).catch(()=>{})
    client.listSalesChannels().then(r=>setSalesChannels(r.sales_channels)).catch(()=>{})
  },[mode,query,status,client,auth])

  useEffect(()=>{
    if(mode!=="live"||!selected||!client.authenticated){if(mode==="demo"&&selected)setContexts(x=>x);return}
    client.getContext(selected.id).then(r=>{if(r.product_context)setContexts(x=>({...x,[selected.id]:r.product_context!}))}).catch(()=>{})
  },[mode,selected,client,auth])

  useEffect(()=>{
    if(mode!=="live"||!client.authenticated)return
    if(tab==="collections")client.listCollections().then(r=>setCollections(r.collections)).catch(e=>setError(e instanceof Error?e.message:"系列读取失败"))
    if(tab==="categories")client.listCategories().then(r=>setCategories(r.product_categories)).catch(e=>setError(e instanceof Error?e.message:"分类读取失败"))
    if(tab==="inventory")Promise.all([client.listInventoryItems(),client.listStockLocations()]).then(([a,b])=>{setInventoryItems(a.inventory_items);setStockLocations(b.stock_locations)}).catch(e=>setError(e instanceof Error?e.message:"库存读取失败"))
  },[mode,tab,client,auth])

  useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(""),2200);return()=>window.clearTimeout(t)},[toast])
  useEffect(()=>{if(mode!=="live"||!client.authenticated||!editor)return;Promise.all([client.listCollections(),client.listCategories()]).then(([a,b])=>{setCollections(a.collections);setCategories(b.product_categories)}).catch(()=>{})},[mode,client,auth,editor?.product.id])
  useEffect(()=>{setSelectedIds([])},[query,status])

  const locked=mode==="live"&&!client.authenticated
  const filtered=useMemo(()=>items.filter(p=>(!query||[p.title,p.subtitle,p.handle,p.description,p.material].join(" ").toLowerCase().includes(query.toLowerCase()))&&(status==="all"||p.status===status)),[items,query,status])

  function open(p:Product){setTab("products");setSelected(p);setMenu(false);setError("")}
  function startEdit(section:EditorSection="details"){if(!selected)return;setEditor({product:cloneProduct(selected),section})}
  function create(){setSelected(null);setEditor({product:emptyProduct(),section:"details"});setError("")}
  function go(id:typeof tab){setTab(id);setSelected(null);setSelectedIds([]);setMenu(false);setError("")}
  function toggleSelected(id:string){setSelectedIds(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id])}
  function clearSelection(){setSelectedIds([])}
  function openImport(){setImportRows([]);setImportOpen(true);setError("")}
  function exportCurrent(){
    const csv=catalogCsv(items.filter(p=>selectedIds.includes(p.id)),contexts)
    downloadText(csv,selectedIds.length?"product-catalog-selected.csv":"product-catalog.csv")
    setToast(selectedIds.length?"已导出 "+selectedIds.length+" 个产品":"已导出当前产品")
  }
  async function exportAll(){
    setBusy(true);setError("")
    try{
      const source=mode==="live"?await client.listAllProducts(query,status==="all"?undefined:status):filtered
      downloadText(catalogCsv(source,contexts),"product-catalog.csv")
      setToast("已导出 "+source.length+" 个产品")
    }catch(e){setError(e instanceof Error?e.message:"导出失败")}finally{setBusy(false)}
  }
  async function applyBulk(action:BulkAction,targetId?:string){
    const chosen=items.filter(p=>selectedIds.includes(p.id))
    if(!chosen.length)return
    if(action==="delete"&&!window.confirm("确定删除 "+chosen.length+" 个产品吗？此操作不可撤销。"))return
    setBusy(true);setError("")
    try{
      if(mode==="demo"){
        const targetCategory=categories.find(x=>x.id===targetId)||[{id:"fabric",name:"Fabrics",handle:"fabrics"},{id:"knit",name:"Knits",handle:"knits"}].find(x=>x.id===targetId)
        const targetChannel=salesChannels.find(x=>x.id===targetId)||[{id:"demo-web",name:"US Storefront"},{id:"demo-b2b",name:"Distributor Portal"}].find(x=>x.id===targetId)
        let next=items
        if(action==="delete")next=next.filter(p=>!selectedIds.includes(p.id))
        if(action==="publish"||action==="draft")next=next.map(p=>selectedIds.includes(p.id)?{...p,status:action==="publish"?"published":"draft"}:p)
        if(action==="collection")next=next.map(p=>selectedIds.includes(p.id)?{...p,collection_id:targetId}:p)
        if(action==="category"&&targetCategory)next=next.map(p=>selectedIds.includes(p.id)?{...p,categories:[...(p.categories||[]).filter(c=>c.id!==targetCategory.id),{id:targetCategory.id,name:targetCategory.name}]}:p)
        if(action==="sales"&&targetChannel)next=next.map(p=>selectedIds.includes(p.id)?{...p,sales_channels:[...(p.sales_channels||[]).filter(c=>c.id!==targetChannel.id),targetChannel]}:p)
        setItems(next);saveDemoProducts(next)
      }else if(action==="publish"||action==="draft"){
        const r=await client.batchProducts({update:chosen.map(p=>({id:p.id,status:action==="publish"?"published":"draft"}))})
        const byId=new Map(r.updated.map(p=>[p.id,p]));setItems(x=>x.map(p=>byId.get(p.id)||p))
      }else if(action==="delete"){
        await client.batchProducts({delete:selectedIds});setItems(x=>x.filter(p=>!selectedIds.includes(p.id)))
      }else if(action==="collection"){
        if(!targetId)throw Error("请选择系列")
        await client.updateCollectionProducts(targetId,{add:selectedIds})
        setItems(x=>x.map(p=>selectedIds.includes(p.id)?{...p,collection_id:targetId}:p))
      }else if(action==="category"){
        if(!targetId)throw Error("请选择分类")
        await client.updateCategoryProducts(targetId,{add:selectedIds})
        const category=categories.find(x=>x.id===targetId)
        if(category)setItems(x=>x.map(p=>selectedIds.includes(p.id)?{...p,categories:[...(p.categories||[]).filter(c=>c.id!==targetId),{id:targetId,name:category.name}]}:p))
      }else if(action==="sales"){
        if(!targetId)throw Error("请选择销售渠道")
        const channel=salesChannels.find(x=>x.id===targetId)
        if(!channel)throw Error("销售渠道不存在")
        const updated=await Promise.all(chosen.map(p=>{const ids=[...(p.sales_channels||[]).map(x=>x.id),targetId];return client.updateProduct(p.id,{sales_channels:[...new Set(ids)].map(id=>({id}))})}))
        const byId=new Map(updated.map(r=>[r.product.id,r.product]));setItems(x=>x.map(p=>byId.get(p.id)||p))
      }
      setSelectedIds([]);setBulkOpen(false);setToast(action==="delete"?"已删除产品":action==="publish"?"已发布选中产品":action==="draft"?"已改为草稿":"已更新选中产品")
    }catch(e){setError(e instanceof Error?e.message:"批量操作失败")}finally{setBusy(false)}
  }
  async function updateInventory(item:InventoryItem,locationId:string,quantity:number){
    if(!Number.isFinite(quantity)||quantity<0){setError("库存数量必须是非负数字");return}
    setBusy(true);setError("")
    try{
      const level=item.location_levels.find(x=>x.location_id===locationId)
      if(mode==="demo"){
        const next=inventoryItems.map(x=>x.id!==item.id?x:{...x,location_levels:[...(x.location_levels||[]).filter(l=>l.location_id!==locationId),{id:level?.id||"demo-level-"+Date.now(),inventory_item_id:x.id,location_id:locationId,stocked_quantity:quantity,reserved_quantity:level?.reserved_quantity||0,available_quantity:Math.max(0,quantity-(level?.reserved_quantity||0)),incoming_quantity:level?.incoming_quantity||0}]})
        setInventoryItems(next)
      }else{
        const r=level?await client.updateInventoryLevel(item.id,locationId,quantity):await client.createInventoryLevel(item.id,locationId,quantity)
        setInventoryItems(x=>x.map(v=>v.id===item.id?r.inventory_item:v))
      }
      setToast("库存已更新")
    }catch(e){setError(e instanceof Error?e.message:"库存更新失败")}finally{setBusy(false)}
  }

  async function importCatalog(rows:CatalogImportRow[]){
    if(!rows.length)throw Error("CSV 没有数据行")
    const groups=new Map<string,{row:CatalogImportRow;rows:CatalogImportRow[]}>()
    const byHandle=new Map(items.map(p=>[p.handle,p]))
    for(const row of rows){
      const title=row["Product Title"].trim(),id=row["Product Id"].trim(),handle=row["Product Handle"].trim()
      if(!title&&!id)throw Error("存在没有 Product Id 和 Product Title 的行")
      const resolvedId=id||byHandle.get(handle)?.id||""
      const key=resolvedId||handle||title
      const normalized={...row,"Product Id":resolvedId}
      const current=groups.get(key)
      if(current)current.rows.push(normalized);else groups.set(key,{row:normalized,rows:[normalized]})
    }
    const create:any[]=[];const update:any[]=[];const variantOps:Array<{id:string;create:any[];update:any[]}>=[];const optionOps:Array<{id:string;add:any[]}>=[];const contextOps:Array<{id:string;handle:string;title:string;context:Omit<ProductContext,"id"|"product_id">}>=[];let createdCount=0
    for(const group of groups.values()){
      const first=group.row
      const options=new Map<string,Set<string>>()
      const variants=group.rows.map(row=>{
        let opts:Record<string,string>={}
        if(row["Variant Options"].trim()){try{opts=JSON.parse(row["Variant Options"])}catch{throw Error("Variant Options JSON 无效："+row["Product Title"])}}
        for(const [k,v] of Object.entries(opts)){if(!options.has(k))options.set(k,new Set());options.get(k)!.add(v)}
        const rawAmount=row["Variant Price"].trim(),amount=rawAmount===""?0:Number(rawAmount)
        let prices:any[]=[]
        if(row["Variant Prices"].trim()){try{prices=JSON.parse(row["Variant Prices"])}catch{throw Error("Variant Prices JSON 无效："+row["Product Title"])}}
        if(!prices.length)prices=[{currency_code:(row["Variant Currency"].trim()||"usd").toLowerCase(),amount}]
        if(prices.some((p:any)=>!p||typeof p.currency_code!=="string"||!Number.isFinite(Number(p.amount))||Number(p.amount)<0))throw Error("Variant Prices 无效："+row["Product Title"])
        return {id:row["Variant Id"].trim(),title:row["Variant Title"].trim()||titleForVariant(first),sku:row["Variant SKU"].trim()||undefined,options:opts,prices,manage_inventory:parseBool(row["Variant Manage Inventory"],true),allow_backorder:parseBool(row["Variant Allow Backorder"],false)}
      }).filter(v=>v.title||v.sku)
      const base:any={title:first["Product Title"].trim(),handle:first["Product Handle"].trim()||undefined,subtitle:first["Product Subtitle"].trim()||undefined,status:validStatus(first["Product Status"]),description:first["Product Description"].trim()||undefined,material:first["Product Material"].trim()||undefined,origin_country:first["Product Origin Country"].trim()||undefined,thumbnail:first["Product Thumbnail"].trim()||undefined,images:splitPipe(first["Product Images"]).map(url=>({url})),collection_id:first["Product Collection Id"].trim()||undefined,categories:splitPipe(first["Product Category Ids"]).map(id=>({id})),sales_channels:splitPipe(first["Product Sales Channel Ids"]).map(id=>({id}))}
      const hasContext=[first["Agent Status"],first["Agent Readiness"],first["Agent Buyer Profile"],first["Agent Markets"],first["Agent Use Cases"],first["Agent Selling Points"],first["Agent Missing Evidence"],first["Agent Evidence"],first["Agent Commercial Policy"],first["Agent Summary"]].some(x=>x.trim())
      let importedContext:Omit<ProductContext,"id"|"product_id">|undefined
      if(hasContext){
        let evidence:EvidenceItem[]=[];let commercialPolicy:CommercialPolicy={}
        if(first["Agent Evidence"].trim()){try{evidence=JSON.parse(first["Agent Evidence"])}catch{throw Error("Agent Evidence JSON 无效："+first["Product Title"])}}
        if(first["Agent Commercial Policy"].trim()){try{commercialPolicy=JSON.parse(first["Agent Commercial Policy"])}catch{throw Error("Agent Commercial Policy JSON 无效："+first["Product Title"])}}
        const readiness=first["Agent Readiness"].trim()===""?0:Number(first["Agent Readiness"])
        if(!Number.isFinite(readiness)||readiness<0||readiness>100)throw Error("Agent Readiness 无效："+first["Product Title"])
        importedContext={status:validContextStatus(first["Agent Status"]),readiness_score:readiness,buyer_profile:first["Agent Buyer Profile"].trim()||null,target_markets:splitPipe(first["Agent Markets"]),use_cases:splitPipe(first["Agent Use Cases"]),selling_points:splitPipe(first["Agent Selling Points"]),evidence,commercial_policy:commercialPolicy,missing_evidence:splitPipe(first["Agent Missing Evidence"]),agent_summary:first["Agent Summary"].trim()||null,source_hash:null,review_version:undefined,reviewed_at:null,reviewed_by:null,notes:null}
      }
      const id=first["Product Id"].trim()
      if(!id){
        const product:any={...base}
        for(const [title,values] of options)product.options=[...(product.options||[]),{title,values:[...values]}]
        if(variants.length)product.variants=variants.map(v=>{const {id:_,...rest}=v;return rest})
        create.push(product)
        if(importedContext)contextOps.push({id:"",handle:product.handle||"",title:product.title,context:importedContext})
      }else{
        update.push({id,...base})
        const existing=items.find(p=>p.id===id)
        const additions=[...options.entries()].filter(([title])=>!(existing?.options||[]).some(o=>o.title===title)).map(([title,values])=>({title,values:[...values],is_exclusive:true}))
        if(additions.length)optionOps.push({id,add:additions})
        if(variants.length)variantOps.push({id,create:variants.filter(v=>!v.id),update:variants.filter(v=>!!v.id)})
        if(importedContext)contextOps.push({id,handle:base.handle||existing?.handle||"",title:base.title,context:importedContext})
      }
    }
    if(mode==="demo"){
      let next=[...items];const createdProducts:Product[]=[]
      for(const p of create){const stamp=Date.now()+"-"+next.length;const product={...p,id:"demo-import-"+stamp,images:p.images||[],variants:(p.variants||[]).map((v:any,i:number)=>({...v,id:"demo-v-"+stamp+"-"+i}))} as Product;next.unshift(product);createdProducts.push(product);createdCount++}
      for(const p of update)next=next.map(x=>x.id===p.id?{...x,...p,images:p.images||x.images,categories:p.categories||x.categories,sales_channels:p.sales_channels||x.sales_channels}:x)
      let nextContexts={...contexts}
      for(const op of contextOps){const target=op.id?next.find(p=>p.id===op.id):createdProducts.find(p=>p.handle===op.handle||p.title===op.title);if(target)nextContexts={...nextContexts,[target.id]:{...op.context,id:"ctx-"+target.id,product_id:target.id}}}
      setItems(next);saveDemoProducts(next);setContexts(nextContexts);saveDemoContexts(nextContexts)
    }else{
      const result=await client.batchProducts({create,update})
      createdCount=result.created.length
      for(const op of optionOps)if(op.add.length)await client.linkOptions(op.id,{add:op.add})
      for(const op of variantOps)if(op.create.length||op.update.length)await client.batchVariants(op.id,{create:op.create,update:op.update})
      for(const op of contextOps){const target=op.id?op.id:result.created.find(p=>p.handle===op.handle||p.title===op.title)?.id;if(target)await client.saveContext(target,contextPayload({...op.context,id:"ctx-"+target,product_id:target}))}
      const fresh=await client.listAllProducts(query,status==="all"?undefined:status)
      setItems(fresh)
      const contextList=await client.listContexts().catch(()=>({product_contexts:[] as ProductContext[]}));setContexts(Object.fromEntries(contextList.product_contexts.map(c=>[c.product_id,c])))
    }
    setImportRows([]);setImportOpen(false);setSelectedIds([]);setToast("已导入 "+groups.size+" 个产品"+(createdCount?"，新建 "+createdCount:""))
  }

  async function saveProduct(draft:DraftProduct){
    if(!draft.title.trim())return
    setBusy(true);setError("")
    try{
      const prepared=await prepareImages(draft,client,mode)
      const sanitized=sanitizeDraft(prepared)
      let product:Product
      if(mode==="demo"){
        product={...sanitized,id:draft.id||"demo-"+Date.now(),images:sanitized.images.map(({file,...i})=>i)}
        const next=draft.id?items.map(p=>p.id===product.id?product:p):[product,...items]
        setItems(next);saveDemoProducts(next);setSelected(product);setEditor(null);setToast("产品已保存")
      }else if(draft.id){
        const r=await client.saveProductStructure(draft.id,selected||draft,sanitized)
        product=r.product;setItems(x=>x.map(p=>p.id===product.id?product:p));setSelected(product);setEditor(null);setToast("产品已同步到 Medusa")
      }else{
        const r=await client.createProduct({
          title:sanitized.title,subtitle:sanitized.subtitle||undefined,handle:sanitized.handle||undefined,
          description:sanitized.description||undefined,material:sanitized.material||undefined,origin_country:sanitized.origin_country||undefined,
          status:sanitized.status,images:sanitized.images.map(i=>({url:i.url})),thumbnail:sanitized.images[0]?.url||undefined,
          collection_id:sanitized.collection_id||undefined,categories:(sanitized.categories||[]).map(x=>({id:x.id})),sales_channels:(sanitized.sales_channels||[]).map(x=>({id:x.id})),
          options:sanitized.options.map(o=>({title:o.title,values:o.values})),
          variants:sanitized.variants.map(v=>variantCreatePayload(v))
        })
        product=r.product;setItems(x=>[product,...x]);setSelected(product);setEditor(null);setToast("产品已创建")
      }
    }catch(e){setError(e instanceof Error?e.message:"保存产品失败")}
    finally{setBusy(false)}
  }

  async function saveContext(next:ProductContext){
    if(!selected)return
    setBusy(true);setError("")
    try{
      if(next.status==="approved"&&(next.readiness_score<80||next.missing_evidence?.length||(next.evidence||[]).some(x=>x.status==="missing"))){
        throw Error("只有就绪度 ≥ 80 且没有缺失证据时才能标记为已通过")
      }
      if(mode==="demo"){
        const nextMap={...contexts,[selected.id]:next};setContexts(nextMap);saveDemoContexts(nextMap);setContextEditor(null);setToast("Agent 资料已保存")
      }else{
        const r=await client.saveContext(selected.id,contextPayload(next))
        setContexts(x=>({...x,[selected.id]:r.product_context}));setContextEditor(null);setToast("Agent 资料已保存")
      }
    }catch(e){setError(e instanceof Error?e.message:"保存 Agent 资料失败")}
    finally{setBusy(false)}
  }

  async function publish(){
    if(!selected)return
    setBusy(true);setError("")
    try{
      if(mode==="demo"){
        const product={...selected,status:"published" as ProductStatus};const next=items.map(p=>p.id===product.id?product:p);setItems(next);saveDemoProducts(next);setSelected(product)
      }else{
        const r=await client.updateProduct(selected.id,{status:"published"});setSelected(r.product);setItems(x=>x.map(p=>p.id===r.product.id?r.product:p))
      }
      setToast("产品已发布")
    }catch(e){setError(e instanceof Error?e.message:"发布失败")}finally{setBusy(false)}
  }

  function nav(id:typeof tab,label:string,icon:string){return <button className={tab===id?"active":""} onClick={()=>go(id)}><Icon n={icon}/><span>{label}</span></button>}

  return <div className="app">
    <aside className={"side "+(menu?"open":"")}>
      <div className="logo"><b>P</b><span>Product<br/><small>Catalog</small></span></div>
      <div className="mode">{mode==="demo"?"离线预览":"Medusa v2"}<small>{mode==="demo"?"LOCAL":"COMMERCE CORE"}</small></div>
      <nav>{nav("products","产品","box")}{nav("collections","系列","grid")}{nav("categories","分类","folder")}{nav("inventory","库存","warehouse")}{nav("agent","Agent 数据","spark")}</nav>
      <div className="side-bottom">
        <button onClick={()=>{const nextMode=mode==="demo"?"live":"demo";setMode(nextMode);setSelected(null);setSelectedIds([]);setMenu(false);if(nextMode==="demo"){setInventoryItems(previewInventory.map(x=>({...x,location_levels:x.location_levels.map(l=>({...l}))})));setStockLocations(previewLocations.map(x=>({...x})))}else{setInventoryItems([]);setStockLocations([])}}}>{mode==="demo"?"连接真实 Medusa":"切回离线预览"}<Icon n="arrow"/></button>
        <small>独立应用 · 不连接 Workspace</small>
      </div>
    </aside>
    <main>
      <header className="topbar"><button className="hamb" onClick={()=>setMenu(!menu)}><Icon n="menu"/></button><span className="crumb">产品库{selected?" / "+(selected.title||"新产品"):""}</span><span className={"pill "+mode}>{mode==="demo"?"Preview":"Live"}</span></header>
      {error&&<div className="global-error"><Icon n="alert"/><span>{error}</span><button onClick={()=>setError("")}><Icon n="close"/></button></div>}
      {locked&&<Login client={client} done={()=>setAuth(x=>x+1)}/>}
      {!locked&&tab==="products"&&!selected&&<ProductList items={filtered} contexts={contexts} query={query} setQuery={setQuery} status={status} setStatus={setStatus} open={open} create={create} selectedIds={selectedIds} toggleSelected={toggleSelected} clearSelection={clearSelection} openBulk={()=>setBulkOpen(true)} openImport={openImport} exportCurrent={exportCurrent} exportAll={exportAll}/>}

      {!locked&&tab==="products"&&selected&&<Detail p={selected} context={contexts[selected.id]} back={()=>setSelected(null)} edit={()=>startEdit("details")} editVariants={()=>startEdit("variants")} editContext={()=>setContextEditor(contexts[selected.id]||emptyContext(selected.id))} publish={publish} busy={busy}/>}
      {!locked&&tab==="agent"&&<AgentPage items={items} contexts={contexts} open={open}/>}
      {!locked&&tab==="collections"&&<CollectionPage items={collections} mode={mode}/>}
      {!locked&&tab==="categories"&&<CategoryPage items={categories} mode={mode}/>}
      {!locked&&tab==="inventory"&&<InventoryPage items={inventoryItems} locations={stockLocations} mode={mode} busy={busy} update={updateInventory}/>}
      {editor&&<ProductEditor value={editor.product} initialSection={editor.section} busy={busy} close={()=>setEditor(null)} save={saveProduct} collections={collections} categories={categories} salesChannels={salesChannels} mode={mode}/>}
      {contextEditor&&<ContextEditor value={contextEditor} busy={busy} close={()=>setContextEditor(null)} save={saveContext}/>}
      {bulkOpen&&<BulkDrawer count={selectedIds.length} collections={collections} categories={categories} salesChannels={salesChannels} mode={mode} busy={busy} close={()=>setBulkOpen(false)} apply={applyBulk}/>}
      {importOpen&&<ImportDrawer rows={importRows} setRows={setImportRows} busy={busy} close={()=>setImportOpen(false)} importRows={importCatalog}/>}

      {toast&&<div className="toast"><Icon n="check"/>{toast}</div>}
    </main>
  </div>
}

function ProductList({items,contexts,query,setQuery,status,setStatus,open,create,selectedIds,toggleSelected,clearSelection,openBulk,openImport,exportCurrent,exportAll}:{items:Product[];contexts:Record<string,ProductContext>;query:string;setQuery:(x:string)=>void;status:"all"|ProductStatus;setStatus:(x:"all"|ProductStatus)=>void;open:(p:Product)=>void;create:()=>void;selectedIds:string[];toggleSelected:(id:string)=>void;clearSelection:()=>void;openBulk:()=>void;openImport:()=>void;exportCurrent:()=>void;exportAll:()=>void}){
  const ready=items.filter(p=>(contexts[p.id]?.readiness_score??commerceReadiness(p))>=80).length
  const allSelected=items.length>0&&items.every(p=>selectedIds.includes(p.id))
  return <section className="page">
    <div className="head"><div><span className="eyebrow">PRODUCTS</span><h1>产品</h1><p>Commerce 数据负责商品本身，Agent Context 负责判断这个商品是否值得被拿去开发市场。</p></div><div className="head-actions"><button className="secondary" onClick={openImport}><Icon n="upload"/>导入</button><button className="secondary" onClick={exportAll}><Icon n="download"/>导出</button><button className="primary" onClick={create}><Icon n="plus"/>新建</button></div></div>
    <div className="metrics"><Metric t="全部" v={items.length}/><Metric t="草稿" v={items.filter(x=>x.status==="draft").length}/><Metric t="已发布" v={items.filter(x=>x.status==="published").length}/><Metric t="Agent 就绪" v={ready}/></div>
    <div className="tools"><label><Icon n="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索产品、材质、Handle…"/></label><div className="tabs">{(["all","draft","published","proposed"] as const).map(x=><button className={status===x?"on":""} onClick={()=>setStatus(x)} key={x}>{x==="all"?"全部":labels[x]}</button>)}</div></div>
    {selectedIds.length>0&&<div className="bulkbar"><label className="select-all"><input type="checkbox" checked={allSelected} onChange={()=>{if(allSelected)clearSelection();else items.forEach(p=>{if(!selectedIds.includes(p.id))toggleSelected(p.id)})}}/><span>已选 {selectedIds.length}</span></label><div className="bulk-actions"><button className="secondary" onClick={openBulk}><Icon n="sliders"/>批量操作</button><button className="secondary" onClick={exportCurrent}><Icon n="download"/>导出选中</button><button className="ghost-button" onClick={clearSelection}>清除</button></div></div>}
    <div className="grid">{items.map(p=>{const checked=selectedIds.includes(p.id);return <article className={"card "+(checked?"selected-card":"")} key={p.id} role="button" tabIndex={0} onClick={()=>open(p)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")open(p)}}><label className="card-select" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={checked} onChange={()=>toggleSelected(p.id)}/></label><MediaView src={p.thumbnail||p.images?.[0]?.url||"swatch-a"} initials={p.title.slice(0,2)} className="art"/><div className="card-body"><div className="line"><span className={"status "+p.status}>{labels[p.status]}</span><small>{contexts[p.id]?contexts[p.id].readiness_score+"% ready":commerceReadiness(p)+"% complete"}</small></div><h3>{p.title}</h3><p>{p.subtitle||p.description||"暂无简介"}</p><div className="meta"><span>{p.material||"未填写材质"}</span><span>{p.variants?.length||0} variants</span></div></div></article>})}</div>
    {!items.length&&<div className="empty"><div><h3>没有匹配产品</h3><p>换一个关键词，或者创建第一个产品。</p></div></div>}
  </section>
}

function Detail({p,context,back,edit,editVariants,editContext,publish,busy}:{p:Product;context?:ProductContext;back:()=>void;edit:()=>void;editVariants:()=>void;editContext:()=>void;publish:()=>void;busy:boolean}){
  const [view,setView]=useState<"overview"|"variants"|"agent">("overview")
  const [image,setImage]=useState(0)
  useEffect(()=>{setView("overview");setImage(0)},[p.id])
  const images=p.images?.length?p.images:[{url:p.thumbnail||"swatch-a"}]
  const readiness=context?.readiness_score??commerceReadiness(p)
  return <section className="detail">
    <button className="back" onClick={back}><Icon n="back"/>返回产品</button>
    <div className="detail-head"><div><div className="head-status"><span className={"status "+p.status}>{labels[p.status]}</span>{context&&<span className={"context-status "+context.status}>{contextLabels[context.status]}</span>}</div><h1>{p.title}</h1><p>{p.subtitle||"未设置副标题"}</p></div><div className="actions"><button className="secondary" onClick={edit}>编辑</button>{p.status!=="published"&&<button className="primary" disabled={busy} onClick={publish}>发布</button>}</div></div>
    <div className="detail-tabs"><button className={view==="overview"?"on":""} onClick={()=>setView("overview")}>概览</button><button className={view==="variants"?"on":""} onClick={()=>setView("variants")}>规格 <small>{p.variants?.length||0}</small></button><button className={view==="agent"?"on":""} onClick={()=>setView("agent")}>Agent <small>{readiness}%</small></button></div>
    {view==="overview"&&<div className="detail-grid"><div><MediaView src={images[image].url} initials={p.title.slice(0,2)} className="hero-art"/><div className="thumbs">{images.map((x,n)=><button key={n} className={image===n?"selected":""} onClick={()=>setImage(n)}><MediaView src={x.url} initials="" className="thumb-media"/></button>)}</div></div><div className="detail-content"><Info title="产品信息"><Row k="Handle" v={p.handle||"自动生成"}/><Row k="材质" v={p.material||"未填写"}/><Row k="原产地" v={p.origin_country||"未填写"}/><Row k="系列" v={p.collection_id||"未分配"}/><Row k="分类" v={p.categories?.map(x=>x.name).join(", ")||"未分类"}/><Row k="销售渠道" v={p.sales_channels?.filter(x=>!x.is_disabled).map(x=>x.name).join(", ")||"未分配"}/></Info><Info title="描述"><p className="copy">{p.description||"暂无描述"}</p></Info><MediaSummary images={images}/></div></div>}
    {view==="variants"&&<VariantsView p={p} edit={editVariants}/>}
    {view==="agent"&&<AgentView context={context} readiness={readiness} edit={editContext}/>}
  </section>
}

function VariantsView({p,edit}:{p:Product;edit:()=>void}){
  return <div className="wide-stack"><div className="section-title"><div><span className="eyebrow">COMMERCE</span><h2>规格与价格</h2><p>Variant 和 Option 继续使用 Medusa 原生 Product Module，不复制一套商品引擎。</p></div><button className="secondary" onClick={edit}><Icon n="edit"/>管理规格</button></div>{(p.options||[]).map(o=><div className="option-strip" key={o.id||o.title}><div><b>{o.title}</b><small>{o.is_exclusive===false?"共享选项":"产品选项"}</small></div><div className="chips">{o.values.map(v=><span key={v}>{v}</span>)}</div></div>)}<div className="variant-table">{(p.variants||[]).map(v=><div className="variant-row" key={v.id}><div><b>{v.title}</b><small>{v.sku||"无 SKU"}</small></div><div className="variant-options">{Object.entries(v.options||{}).map(([k,val])=><span key={k}>{k}: {val}</span>)}</div><strong>{price(v.prices?.[0])}</strong></div>)}{!p.variants?.length&&<div className="empty-inline">还没有 Variant。创建选项后可以在这里添加可销售规格。</div>}</div></div>
}

function AgentView({context,readiness,edit}:{context?:ProductContext;readiness:number;edit:()=>void}){
  const missing=context?.missing_evidence||[]
  return <div className="agent-layout"><div className="agent-score"><div className="score-top"><div><span className="eyebrow">PRODUCT CONTEXT</span><h2>Agent 就绪度</h2></div><b>{readiness}%</b></div><div className="progress"><i style={{width:readiness+"%"}}/></div><p>{context?.agent_summary||"还没有经过业务审核。先补充目标买家、应用场景、证据和商业条件。"} </p><button className="primary" onClick={edit}><Icon n="spark"/>编辑 Agent 资料</button></div><div className="agent-facts"><Info title="目标市场">{context?.target_markets?.length?<div className="chips light">{context.target_markets.map(x=><span key={x}>{x}</span>)}</div>:<Muted>未定义</Muted>}</Info><Info title="目标买家"><p className="copy compact">{context?.buyer_profile||"未定义"}</p></Info><Info title="应用场景">{context?.use_cases?.length?<div className="chips light">{context.use_cases.map(x=><span key={x}>{x}</span>)}</div>:<Muted>未定义</Muted>}</Info><Info title="销售要点">{context?.selling_points?.length?<ul className="plain-list">{context.selling_points.map(x=><li key={x}>{x}</li>)}</ul>:<Muted>未定义</Muted>}</Info><Policy policy={context?.commercial_policy}/>{missing.length>0?<div className="missing"><Icon n="alert"/><span><b>还缺 {missing.length} 项</b><small>{missing.join(" · ")}</small></span></div>:<div className="approved-note"><Icon n="check"/><span><b>没有待补证据</b><small>{context?.status==="approved"?"可以进入 Agent 工作流":"资料已齐，可提交审核"}</small></span></div>}</div></div>
}

function AgentPage({items,contexts,open}:{items:Product[];contexts:Record<string,ProductContext>;open:(p:Product)=>void}){
  const ranked=[...items].sort((a,b)=>(contexts[b.id]?.readiness_score??commerceReadiness(b))-(contexts[a.id]?.readiness_score??commerceReadiness(a)))
  const scores=ranked.map(p=>contexts[p.id]?.readiness_score??commerceReadiness(p));const avg=Math.round(scores.reduce((a,b)=>a+b,0)/Math.max(1,scores.length))
  return <section className="page"><div className="head"><div><span className="eyebrow">AGENT DATA</span><h1>Agent 数据</h1><p>这里只放 Agent 做经营判断真正需要的产品上下文，不把它变成一个泛知识库。</p></div></div><div className="agent-metrics"><Metric t="平均就绪度" v={avg+"%"} dark/><Metric t="可直接使用" v={ranked.filter(p=>(contexts[p.id]?.readiness_score??commerceReadiness(p))>=80).length} dark/><Metric t="需要补资料" v={ranked.filter(p=>(contexts[p.id]?.missing_evidence?.length||0)>0).length} dark/></div><div className="ranking">{ranked.map(p=>{const c=contexts[p.id];const score=c?.readiness_score??commerceReadiness(p);return <button key={p.id} onClick={()=>open(p)}><MediaView src={p.thumbnail||p.images?.[0]?.url||"swatch-a"} initials={p.title.slice(0,2)} className="mini"/><span><b>{p.title}</b><small>{c?.buyer_profile||"尚未定义目标买家"}</small></span><strong>{score}%</strong><Icon n="chevron"/></button>})}</div></section>
}

function ProductEditor({value,initialSection,busy,close,save,collections,categories,salesChannels,mode}:{value:DraftProduct;initialSection:EditorSection;busy:boolean;close:()=>void;save:(p:DraftProduct)=>void;collections:{id:string;title:string;handle:string}[];categories:{id:string;name:string;handle:string}[];salesChannels:SalesChannel[];mode:"demo"|"live"}){
  const [draft,setDraft]=useState<DraftProduct>(()=>cloneProduct(value));const [section,setSection]=useState<EditorSection>(initialSection);const fileRef=useRef<HTMLInputElement>(null)
  const update=(patch:Partial<DraftProduct>)=>setDraft(x=>({...x,...patch}))
  const addFiles=async(e:ChangeEvent<HTMLInputElement>)=>{const files=Array.from(e.target.files||[]).filter(f=>f.type.startsWith("image/")&&f.size<=8*1024*1024);if(!files.length)return;const added=await Promise.all(files.map(async file=>({url:await fileDataUrl(file),file})));update({images:[...draft.images,...added]});e.target.value=""}
  const removeImage=(index:number)=>{const next=draft.images.filter((_,i)=>i!==index);update({images:next,thumbnail:next[0]?.url||""})}
  const moveImage=(index:number,delta:number)=>{const next=[...draft.images];const to=index+delta;if(to<0||to>=next.length)return;[next[index],next[to]]=[next[to],next[index]];update({images:next,thumbnail:next[0]?.url||""})}
  const setThumb=(index:number)=>{if(!draft.images[index])return;const next=[...draft.images];const [main]=next.splice(index,1);next.unshift(main);update({images:next,thumbnail:main.url})}
  const demoCollections=mode==="demo"?[{id:"demo-col-1",title:"US Resortwear",handle:"us-resortwear"},{id:"demo-col-2",title:"Core Knits",handle:"core-knits"}]:collections
  const demoCategories=mode==="demo"?[{id:"fabric",name:"Fabrics",handle:"fabrics"},{id:"knit",name:"Knits",handle:"knits"}]:categories
  const demoChannels=mode==="demo"?[{id:"demo-web",name:"US Storefront"},{id:"demo-b2b",name:"Distributor Portal"}]:salesChannels
  const toggleCategory=(id:string)=>update({categories:[...(draft.categories||[]).some(x=>x.id===id)?(draft.categories||[]).filter(x=>x.id!==id):[...(draft.categories||[]),{id,name:demoCategories.find(x=>x.id===id)?.name||id}]]})
  const toggleChannel=(id:string)=>update({sales_channels:[...(draft.sales_channels||[]).some(x=>x.id===id)?(draft.sales_channels||[]).filter(x=>x.id!==id):[...(draft.sales_channels||[]),demoChannels.find(x=>x.id===id)||{id,name:id}]]})
  return <div className="overlay"><form className="drawer" onSubmit={e=>{e.preventDefault();save(draft)}}><header className="drawer-head"><div><span className="eyebrow">{value.id?"EDIT PRODUCT":"NEW PRODUCT"}</span><h2>{value.id?"编辑产品":"新建产品"}</h2></div><button type="button" className="icon-button" onClick={close}><Icon n="close"/></button></header><div className="drawer-tabs">{(["details","media","variants","organization"] as const).map(x=><button type="button" className={section===x?"on":""} onClick={()=>setSection(x)} key={x}>{x==="details"?"基本":x==="media"?"媒体":x==="variants"?"规格":"组织"}</button>)}</div><div className="drawer-body">
    {section==="details"&&<><Field label="产品名称"><input autoFocus required value={draft.title} onChange={e=>update({title:e.target.value})}/></Field><Field label="副标题"><input value={draft.subtitle||""} onChange={e=>update({subtitle:e.target.value})}/></Field><Field label="Handle"><input value={draft.handle} onChange={e=>update({handle:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})}/></Field><Field label="产品描述"><textarea rows={8} value={draft.description||""} onChange={e=>update({description:e.target.value})}/></Field><div className="two"><Field label="材质"><input value={draft.material||""} onChange={e=>update({material:e.target.value})}/></Field><Field label="原产地"><input value={draft.origin_country||""} onChange={e=>update({origin_country:e.target.value})}/></Field></div><Field label="状态"><select value={draft.status} onChange={e=>update({status:e.target.value as ProductStatus})}>{Object.keys(labels).map(x=><option key={x} value={x}>{labels[x as ProductStatus]}</option>)}</select></Field><div className="note"><Icon n="spark"/><span><b>Commerce Product ≠ Agent Context</b><small>买家、市场、证据和销售策略不塞进商品字段，单独由 Product Context 管理。</small></span></div></>}
    {section==="media"&&<MediaEditor images={draft.images} fileRef={fileRef} addFiles={addFiles} removeImage={removeImage} moveImage={moveImage} setThumb={setThumb}/>}
    {section==="variants"&&<VariantsEditor draft={draft} setDraft={setDraft}/>}
    {section==="organization"&&<OrganizationEditor draft={draft} collections={demoCollections} categories={demoCategories} salesChannels={demoChannels} update={update} toggleCategory={toggleCategory} toggleChannel={toggleChannel}/>}
  </div><footer><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy?"保存中…":"保存产品"}</button></footer></form></div>
}

function OrganizationEditor({draft,collections,categories,salesChannels,update,toggleCategory,toggleChannel}:{draft:DraftProduct;collections:{id:string;title:string;handle:string}[];categories:{id:string;name:string;handle:string}[];salesChannels:SalesChannel[];update:(patch:Partial<DraftProduct>)=>void;toggleCategory:(id:string)=>void;toggleChannel:(id:string)=>void}){
  return <div className="editor-section"><div className="section-title"><div><h3>产品组织</h3><p>这些关系直接写回 Medusa Product，不复制一套平台数据。</p></div></div>
    <div className="field"><span>系列</span><select value={draft.collection_id||""} onChange={e=>update({collection_id:e.target.value||null})}><option value="">不分配系列</option>{collections.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></div>
    <div className="org-block"><div className="mini-heading">分类</div><div className="org-checks">{categories.map(x=><label key={x.id}><input type="checkbox" checked={(draft.categories||[]).some(c=>c.id===x.id)} onChange={()=>toggleCategory(x.id)}/><span>{x.name}</span></label>)}</div></div>
    <div className="org-block"><div className="mini-heading">销售渠道</div><div className="org-checks">{salesChannels.filter(x=>!x.is_disabled).map(x=><label key={x.id}><input type="checkbox" checked={(draft.sales_channels||[]).some(c=>c.id===x.id)} onChange={()=>toggleChannel(x.id)}/><span>{x.name}</span></label>)}</div>{!salesChannels.filter(x=>!x.is_disabled).length&&<div className="empty-inline">暂无可用销售渠道</div>}</div>
    <div className="note"><Icon n="alert"/><span><b>数组关系会替换现有值</b><small>保存时会完整提交当前分类和销售渠道集合；新增/移除都在这里一次确定。</small></span></div>
  </div>
}

function MediaEditor({images,fileRef,addFiles,removeImage,moveImage,setThumb}:{images:DraftImage[];fileRef:RefObject<HTMLInputElement>;addFiles:(e:ChangeEvent<HTMLInputElement>)=>void;removeImage:(i:number)=>void;moveImage:(i:number,d:number)=>void;setThumb:(i:number)=>void}){
  return <div className="editor-section"><div className="section-title"><div><h3>产品媒体</h3><p>上传真实图片。第一张自动作为缩略图，也可以手动调整。</p></div><button type="button" className="secondary" onClick={()=>fileRef.current?.click()}><Icon n="upload"/>上传图片</button></div><input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={addFiles}/><div className="media-grid">{images.map((x,i)=><div className={"media-item "+(i===0?"thumbnail":"")} key={x.id||x.url+i}><MediaView src={x.url} initials="" className="media-preview"/><div className="media-actions"><button type="button" onClick={()=>moveImage(i,-1)} disabled={i===0}><Icon n="up"/></button><button type="button" onClick={()=>moveImage(i,1)} disabled={i===images.length-1}><Icon n="down"/></button><button type="button" onClick={()=>setThumb(i)} className={i===0?"on":""}><Icon n="image"/>{i===0?"主图":"设为主图"}</button><button type="button" onClick={()=>removeImage(i)}><Icon n="trash"/></button></div></div>)}</div>{!images.length&&<button type="button" className="upload-empty" onClick={()=>fileRef.current?.click()}><Icon n="upload"/><b>上传产品图片</b><small>PNG / JPG / WEBP · 单张不超过 8MB</small></button>}</div>
}

function VariantsEditor({draft,setDraft}:{draft:DraftProduct;setDraft:Dispatch<SetStateAction<DraftProduct>>}){
  const setOption=(index:number,key:"title"|"values",value:string)=>setDraft(d=>{const options=[...d.options];options[index]={...options[index],...(key==="values"?{values:splitValues(value)}:{title:value})};return {...d,options}})
  const addOption=()=>setDraft(d=>({...d,options:[...d.options,{title:"新选项",values:["默认"],is_exclusive:true}]}))
  const removeOption=(index:number)=>setDraft(d=>({...d,options:d.options.filter((_,i)=>i!==index)}))
  const addVariant=()=>setDraft(d=>({...d,variants:[...d.variants,{id:"new-"+Date.now()+"-"+d.variants.length,title:"新规格",sku:"",options:defaultVariantOptions(d.options),prices:[{currency_code:"usd",amount:0}]}]}))
  const updateVariant=(index:number,patch:Partial<ProductVariant>)=>setDraft(d=>{const variants=[...d.variants];variants[index]={...variants[index],...patch};return {...d,variants}})
  const removeVariant=(index:number)=>setDraft(d=>({...d,variants:d.variants.filter((_,i)=>i!==index)}))
  const setVariantOption=(index:number,key:string,value:string)=>setDraft(d=>{const variants=[...d.variants];variants[index]={...variants[index],options:{...(variants[index].options||{}),[key]:value}};return {...d,variants}})
  const setPrice=(index:number,value:string)=>{const current=draft.variants[index].prices||[];const first=current[0]||{currency_code:"usd"};updateVariant(index,{prices:[{...first,amount:Number(value)||0},...current.slice(1)]})}
  return <div className="editor-section"><div className="section-title"><div><h3>规格</h3><p>Option 决定可选值，Variant 是实际可销售的组合。</p></div><button type="button" className="secondary" onClick={addVariant}><Icon n="plus"/>添加 Variant</button></div><div className="option-editor">{draft.options.map((o,i)=><div className="option-edit" key={o.id||"new-"+i}><div className="option-edit-head"><Field label="选项名称"><input value={o.title} disabled={Boolean(o.id&&o.is_exclusive===false)} onChange={e=>setOption(i,"title",e.target.value)}/></Field><button type="button" className="icon-button danger" disabled={Boolean(o.id&&!o.is_exclusive)} onClick={()=>removeOption(i)}><Icon n="trash"/></button></div><Field label="选项值（逗号分隔）"><input value={o.values.join(", ")} disabled={Boolean(o.id&&!o.is_exclusive)} onChange={e=>setOption(i,"values",e.target.value)}/></Field>{o.id&&!o.is_exclusive&&<small className="locked-note"><Icon n="lock"/>共享 Option 在这里仅可解绑，不在商品编辑器里修改。</small>}</div>)}<button type="button" className="add-line" onClick={addOption}><Icon n="plus"/>添加产品选项</button></div><div className="variant-editor">{draft.variants.map((v,i)=><div className="variant-edit" key={v.id}><div className="variant-edit-head"><b>Variant {i+1}</b><button type="button" className="icon-button danger" onClick={()=>removeVariant(i)}><Icon n="trash"/></button></div><div className="variant-fields"><Field label="名称"><input value={v.title} onChange={e=>updateVariant(i,{title:e.target.value})}/></Field><Field label="SKU"><input value={v.sku||""} onChange={e=>updateVariant(i,{sku:e.target.value})}/></Field><Field label={"价格 · "+(v.prices?.[0]?.currency_code||"usd").toUpperCase()}><input type="number" min="0" step="0.01" value={((v.prices?.[0]?.amount||0)).toFixed(2)} onChange={e=>setPrice(i,e.target.value)}/></Field></div>{draft.options.length>0&&<div className="variant-option-fields">{draft.options.map(o=><Field key={o.title} label={o.title}><select value={v.options?.[o.title]||""} onChange={e=>setVariantOption(i,o.title,e.target.value)}>{(!v.options?.[o.title]||!o.values.includes(v.options[o.title]))&&<option value={v.options?.[o.title]||""} disabled>{v.options?.[o.title]||"未读取 / 请选择"}</option>}{o.values.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>)}</div>}</div>)}{!draft.variants.length&&<div className="empty-inline">还没有 Variant。点击右上角添加一个实际可售规格。</div>}</div></div>
}

function ContextEditor({value,busy,close,save}:{value:ProductContext;busy:boolean;close:()=>void;save:(v:ProductContext)=>void}){
  const [d,setD]=useState<ProductContext>(()=>cloneContext(value));const patch=(p:Partial<ProductContext>)=>setD(x=>({...x,...p}))
  const [policy,setPolicy]=useState<CommercialPolicy>({...((value.commercial_policy)||{})})
  const [missing,setMissing]=useState((value.missing_evidence||[]).join(", "))
  const [markets,setMarkets]=useState((value.target_markets||[]).join(", "))
  const [uses,setUses]=useState((value.use_cases||[]).join(", "))
  const [points,setPoints]=useState((value.selling_points||[]).join("\n"))
  const [evidence,setEvidence]=useState<EvidenceItem[]>(value.evidence||[])
  const submit=(e:FormEvent)=>{e.preventDefault();const next={...d,target_markets:splitValues(markets),use_cases:splitValues(uses),selling_points:points.split("\n").map(x=>x.trim()).filter(Boolean),missing_evidence:splitValues(missing),commercial_policy:policy,evidence};save(next)}
  const canApprove=d.readiness_score>=80&&splitValues(missing).length===0
  return <div className="overlay"><form className="drawer" onSubmit={submit}><header className="drawer-head"><div><span className="eyebrow">PRODUCT CONTEXT</span><h2>Agent 资料</h2></div><button type="button" className="icon-button" onClick={close}><Icon n="close"/></button></header><div className="drawer-body context-drawer"><div className="context-score"><div><span>就绪度</span><b>{d.readiness_score}%</b></div><input type="range" min="0" max="100" value={d.readiness_score} onChange={e=>patch({readiness_score:Number(e.target.value)})}/></div><Field label="状态"><select value={d.status} onChange={e=>patch({status:e.target.value as ProductContext["status"]})}>{Object.keys(contextLabels).map(x=><option key={x} value={x}>{contextLabels[x as ProductContext["status"]]}</option>)}</select></Field><Field label="目标买家"><textarea rows={3} value={d.buyer_profile||""} onChange={e=>patch({buyer_profile:e.target.value})}/></Field><Field label="目标市场（逗号分隔）"><input value={markets} onChange={e=>setMarkets(e.target.value)}/></Field><Field label="应用场景（逗号分隔）"><input value={uses} onChange={e=>setUses(e.target.value)}/></Field><Field label="销售要点（每行一条）"><textarea rows={5} value={points} onChange={e=>setPoints(e.target.value)}/></Field><PolicyEditor value={policy} setValue={setPolicy}/><EvidenceEditor items={evidence} setItems={setEvidence}/><Field label="缺失证据（逗号分隔）"><input value={missing} onChange={e=>setMissing(e.target.value)}/></Field><Field label="Agent 摘要"><textarea rows={5} value={d.agent_summary||""} onChange={e=>patch({agent_summary:e.target.value})}/></Field>{d.status==="approved"&&!canApprove&&<div className="form-error">已通过的上下文必须满足：就绪度 ≥ 80%，且缺失证据为 0。</div>}</div><footer><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy||(d.status==="approved"&&!canApprove)}>{busy?"保存中…":"保存 Agent 资料"}</button></footer></form></div>
}

function PolicyEditor({value,setValue}:{value:CommercialPolicy;setValue:Dispatch<SetStateAction<CommercialPolicy>>}){
  const set=(key:keyof CommercialPolicy,val:string)=>setValue(v=>({...v,[key]:key==="currency"||key==="sample_policy"?val:(val===""?undefined:Number(val))}))
  return <div className="policy-editor"><div className="mini-heading">商业条件</div><div className="two"><Field label="MOQ"><input type="number" min="0" value={value.moq??""} onChange={e=>set("moq",e.target.value)}/></Field><Field label="Trial 数量"><input type="number" min="0" value={value.trial_quantity??""} onChange={e=>set("trial_quantity",e.target.value)}/></Field><Field label="价格下限"><input type="number" min="0" step="0.01" value={value.price_min??""} onChange={e=>set("price_min",e.target.value)}/></Field><Field label="价格上限"><input type="number" min="0" step="0.01" value={value.price_max??""} onChange={e=>set("price_max",e.target.value)}/></Field><Field label="币种"><input value={value.currency||""} onChange={e=>set("currency",e.target.value.toUpperCase())}/></Field><Field label="交期（天）"><input type="number" min="0" value={value.lead_time_days??""} onChange={e=>set("lead_time_days",e.target.value)}/></Field></div><Field label="样品政策"><input value={value.sample_policy||""} onChange={e=>set("sample_policy",e.target.value)}/></Field></div>
}

function EvidenceEditor({items,setItems}:{items:EvidenceItem[];setItems:Dispatch<SetStateAction<EvidenceItem[]>>}){
  const add=()=>setItems(x=>[...x,{id:"ev-"+Date.now(),label:"新证据",type:"other",status:"pending"}])
  const update=(id:string,patch:Partial<EvidenceItem>)=>setItems(x=>x.map(e=>e.id===id?{...e,...patch}:e))
  const remove=(id:string)=>setItems(x=>x.filter(e=>e.id!==id))
  return <div className="evidence-editor"><div className="mini-heading">证据</div>{items.map(item=><div className="evidence-row" key={item.id}><input value={item.label} onChange={e=>update(item.id,{label:e.target.value})}/><select value={item.status} onChange={e=>update(item.id,{status:e.target.value as EvidenceItem["status"]})}><option value="verified">已验证</option><option value="pending">待审核</option><option value="missing">缺失</option></select><button type="button" className="icon-button danger" onClick={()=>remove(item.id)}><Icon n="trash"/></button></div>)}<button type="button" className="add-line" onClick={add}><Icon n="plus"/>添加证据</button></div>
}



function InventoryPage({items,locations,mode,busy,update}:{items:InventoryItem[];locations:StockLocation[];mode:"demo"|"live";busy:boolean;update:(item:InventoryItem,locationId:string,quantity:number)=>Promise<void>}){
  const demoLocations=mode==="demo"?previewLocations:locations
  const demoItems=items
  const [search,setSearch]=useState("");const [location,setLocation]=useState("all")
  const visible=demoItems.filter(x=>!search||[x.title,x.sku,x.id].join(" ").toLowerCase().includes(search.toLowerCase()))
  const total=visible.reduce((sum,x)=>sum+x.stocked_quantity,0);const available=visible.reduce((sum,x)=>sum+x.available_quantity,0);const reserved=visible.reduce((sum,x)=>sum+x.reserved_quantity,0)
  return <section className="page"><div className="head"><div><span className="eyebrow">COMMERCE · INVENTORY</span><h1>库存</h1><p>按 Stock Location 管理真实库存数量；Sales Channel 的可售范围继续由 Medusa 原生关系决定。</p></div></div>
    <div className="metrics"><Metric t="库存项" v={visible.length}/><Metric t="在库" v={total}/><Metric t="可用" v={available}/><Metric t="已预留" v={reserved}/></div>
    <div className="tools"><label><Icon n="search"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索 SKU、库存项…"/></label><div className="tabs"><button className={location==="all"?"on":""} onClick={()=>setLocation("all")}>全部</button>{demoLocations.map(x=><button key={x.id} className={location===x.id?"on":""} onClick={()=>setLocation(x.id)}>{x.name}</button>)}</div></div>
    <div className="inventory-list">{visible.map(item=><InventoryCard key={item.id} item={item} locations={demoLocations} location={location} busy={busy} update={update}/>)}</div>
    {!visible.length&&<div className="empty"><div><h3>没有库存项</h3><p>{mode==="live"?"请确认 Medusa 已为 Variant 开启库存管理。":"切换到 Live 后读取真实 Inventory Module。"}</p></div></div>}
  </section>
}

function InventoryCard({item,locations,location,busy,update}:{item:InventoryItem;locations:StockLocation[];location:string;busy:boolean;update:(item:InventoryItem,locationId:string,quantity:number)=>Promise<void>}){
  const levels=location==="all"?locations:locations.filter(x=>x.id===location)
  return <article className="inventory-card"><div className="inventory-head"><div><b>{item.title||"未命名库存项"}</b><small>{item.sku||item.id}</small></div><strong>{item.available_quantity}<small>可用</small></strong></div><div className="inventory-levels">{levels.map(loc=>{const level=item.location_levels.find(x=>x.location_id===loc.id);return <div className="inventory-level" key={loc.id}><span><b>{loc.name}</b><small>{level?level.reserved_quantity+" reserved · "+level.incoming_quantity+" incoming":"尚未建立库存层级"}</small></span><InventoryQuantityInput item={item} location={loc} level={level} busy={busy} update={update}/></div>})}</div></article>
}
function InventoryQuantityInput({item,location,level,busy,update}:{item:InventoryItem;location:StockLocation;level?:InventoryItem["location_levels"][number];busy:boolean;update:(item:InventoryItem,locationId:string,quantity:number)=>Promise<void>}){
  const [value,setValue]=useState(String(level?.stocked_quantity??0))
  useEffect(()=>setValue(String(level?.stocked_quantity??0)),[level?.stocked_quantity])
  const commit=()=>{const next=Number(value);if(Number.isFinite(next)&&next>=0&&next!==(level?.stocked_quantity??0))void update(item,location.id,next);else if(!Number.isFinite(next)||next<0)setValue(String(level?.stocked_quantity??0))}
  return <label className="inventory-input"><input disabled={busy} type="number" min="0" value={value} onChange={e=>setValue(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur()}}/><em>在库</em></label>
}

function BulkDrawer({count,collections,categories,salesChannels,mode,busy,close,apply}:{count:number;collections:{id:string;title:string;handle:string}[];categories:{id:string;name:string;handle:string}[];salesChannels:SalesChannel[];mode:"demo"|"live";busy:boolean;close:()=>void;apply:(action:BulkAction,targetId?:string)=>void}){
  const demoCollections=mode==="demo"?[{id:"demo-col-1",title:"US Resortwear",handle:"us-resortwear"},{id:"demo-col-2",title:"Core Knits",handle:"core-knits"}]:collections
  const demoCategories=mode==="demo"?[{id:"fabric",name:"Fabrics",handle:"fabrics"},{id:"knit",name:"Knits",handle:"knits"}]:categories
  const demoChannels=mode==="demo"?[{id:"demo-web",name:"US Storefront"},{id:"demo-b2b",name:"Distributor Portal"}]:salesChannels
  const [action,setAction]=useState<BulkAction>("publish");const [target,setTarget]=useState("")
  const needsTarget=action==="collection"||action==="category"||action==="sales"
  const targets=action==="collection"?demoCollections:action==="category"?demoCategories:demoChannels
  useEffect(()=>{setTarget(targets[0]?.id||"")},[action,mode])
  return <div className="overlay"><section className="drawer"><header className="drawer-head"><div><span className="eyebrow">BULK ACTION</span><h2>批量处理</h2><p>当前已选 {count} 个产品</p></div><button className="icon-button" onClick={close}><Icon n="close"/></button></header><div className="drawer-body">
    <div className="bulk-action-list">{([
      ["publish","发布","让选中产品进入 storefront"],
      ["draft","改为草稿","暂时从 storefront 下架"],
      ["collection","加入系列","一个产品只属于一个系列"],
      ["category","加入分类","不会移除产品已有的其他分类"],
      ["sales","加入销售渠道","增加一个可售渠道，不覆盖已有渠道"],
      ["delete","删除","永久删除选中产品"]
    ] as [BulkAction,string,string][]).map(([id,label,desc])=><label key={id} className={"bulk-choice "+(action===id?"on":"")}><input type="radio" name="bulk-action" checked={action===id} onChange={()=>setAction(id)}/><span><b>{label}</b><small>{desc}</small></span></label>)}</div>
    {needsTarget&&<Field label={action==="collection"?"目标系列":action==="category"?"目标分类":"目标销售渠道"}><select value={target} onChange={e=>setTarget(e.target.value)}>{targets.map((x:any)=><option key={x.id} value={x.id}>{x.title||x.name}</option>)}</select></Field>}
    {action==="delete"?<div className="danger-note"><Icon n="alert"/><span><b>不可撤销</b><small>Medusa 会删除这些 Product 记录以及它们的商品关系。确认前请先导出备份。</small></span></div>:<div className="note"><Icon n="spark"/><span><b>使用 Medusa 原生关系</b><small>批量发布使用 Product Batch；系列和分类使用 Medusa 的产品关系接口；销售渠道只追加目标渠道。</small></span></div>}
  </div><footer><button className="secondary" onClick={close}>取消</button><button className={action==="delete"?"danger-button":"primary"} disabled={busy||(needsTarget&&!target)} onClick={()=>apply(action,target)}>{busy?"处理中…":action==="delete"?"确认删除":"执行操作"}</button></footer></section></div>
}

function ImportDrawer({rows,setRows,busy,close,importRows}:{rows:CatalogImportRow[];setRows:Dispatch<SetStateAction<CatalogImportRow[]>>;busy:boolean;close:()=>void;importRows:(rows:CatalogImportRow[])=>Promise<void>}){
  const [error,setError]=useState("");const inputRef=useRef<HTMLInputElement>(null)
  const choose=()=>inputRef.current?.click()
  const readFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setError("");try{const text=await file.text();setRows(parseCatalogCsv(text))}catch(x){setRows([]);setError(x instanceof Error?x.message:"CSV 解析失败")}}
  const products=new Set(rows.map(r=>r["Product Id"]||r["Product Handle"]||r["Product Title"]).filter(Boolean)).size
  const runImport=async()=>{setError("");try{await importRows(rows)}catch(x){setError(x instanceof Error?x.message:"导入失败")}}
  return <div className="overlay"><section className="drawer"><header className="drawer-head"><div><span className="eyebrow">CSV IMPORT</span><h2>导入产品</h2><p>使用产品库自己的 CSV schema，可同时携带 Variant 和 Agent Context 摘要字段。</p></div><button className="icon-button" onClick={close}><Icon n="close"/></button></header><div className="drawer-body">
    <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={readFile}/>
    {!rows.length?<button className="upload-empty" onClick={choose}><Icon n="upload"/><b>选择 CSV 文件</b><small>建议使用本产品库导出的 CSV 原样回写</small></button>:<><div className="import-summary"><div><b>{rows.length}</b><small>数据行</small></div><div><b>{products}</b><small>产品</small></div><div><b>{rows.filter(r=>r["Variant Title"]||r["Variant SKU"]).length}</b><small>Variant</small></div></div><div className="import-preview"><div className="mini-heading">前 5 行预览</div>{rows.slice(0,5).map((r,i)=><div key={i}><b>{r["Product Title"]||"未命名"}</b><span>{r["Variant Title"]||"无 Variant"} · {r["Variant SKU"]||"无 SKU"}</span></div>)}</div><button className="secondary full" onClick={choose}>重新选择</button></>}
    {error&&<div className="form-error">{error}</div>}
    <div className="note"><Icon n="alert"/><span><b>导入前会校验</b><small>Product Id 或 Handle、Variant Options JSON、价格、状态和布尔字段。Live 模式写入 Medusa Product Batch；已有产品的 Variant 再走 Variant Batch。</small></span></div>
  </div><footer><button className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy||!rows.length} onClick={runImport}>{busy?"导入中…":"确认导入 "+(rows.length?products+" 个产品":"")}</button></footer></section></div>
}

function CollectionPage({items,mode}:{items:{id:string;title:string;handle:string;products?:{id:string}[]}[];mode:"demo"|"live"}){
  const demo=mode==="demo"?[{id:"demo-col-1",title:"US Resortwear",handle:"us-resortwear",products:[{id:"demo-01"},{id:"demo-03"}]},{id:"demo-col-2",title:"Core Knits",handle:"core-knits",products:[{id:"demo-02"}]}]:items
  return <section className="page"><div className="head"><div><span className="eyebrow">COMMERCE</span><h1>系列</h1><p>直接复用 Medusa Collection，不建立第二套商品归类系统。</p></div></div><div className="simple-list">{demo.map(x=><div key={x.id}><div className="list-icon"><Icon n="grid"/></div><span><b>{x.title}</b><small>{x.handle}</small></span><strong>{x.products?.length||0}<small> products</small></strong></div>)}</div></section>
}
function CategoryPage({items,mode}:{items:{id:string;name:string;handle:string;parent_category_id?:string|null;is_active?:boolean}[];mode:"demo"|"live"}){
  const demo=mode==="demo"?[{id:"demo-cat-1",name:"Fabrics",handle:"fabrics",is_active:true},{id:"demo-cat-2",name:"Knits",handle:"knits",is_active:true}]:items
  return <section className="page"><div className="head"><div><span className="eyebrow">COMMERCE</span><h1>分类</h1><p>分类、层级和商品关系交给 Medusa Product Module。</p></div></div><div className="simple-list">{demo.map(x=><div key={x.id}><div className="list-icon"><Icon n="folder"/></div><span><b>{x.name}</b><small>{x.handle}{x.parent_category_id?" · 子分类":""}</small></span><span className={"active-dot "+(x.is_active===false?"off":"")}>{x.is_active===false?"停用":"启用"}</span></div>)}</div></section>
}

function Login({client,done}:{client:MedusaClient;done:()=>void}){const[e,setE]=useState(""),[p,setP]=useState(""),[err,setErr]=useState(""),[busy,setBusy]=useState(false);async function submit(x:FormEvent){x.preventDefault();setBusy(true);setErr("");try{await client.login(e,p);done()}catch(x){setErr(x instanceof Error?x.message:"登录失败")}finally{setBusy(false)}}return <section className="login"><form onSubmit={submit}><span className="eyebrow">MEDUSA V2 · LIVE</span><h1>连接产品库</h1><p>使用管理员账号。JWT 只存在当前页面内存，不把 Secret API Key 放进前端。</p><Field label="管理员邮箱"><input required type="email" value={e} onChange={x=>setE(x.target.value)}/></Field><Field label="密码"><input required type="password" value={p} onChange={x=>setP(x.target.value)}/></Field>{err&&<div className="form-error">{err}</div>}<button className="primary full" disabled={busy}>{busy?"正在连接…":"连接 Medusa"}</button><small>没有 Medusa 服务时，切回 Preview 即可。</small></form></section>}

function MediaSummary({images}:{images:ProductImage[]}){return <Info title="媒体"><div className="media-summary"><span><Icon n="image"/>{images.length} 张图片</span><span>{images[0]?"第一张为主图":"暂无媒体"}</span></div></Info>}
function Policy({policy}:{policy?:CommercialPolicy|null}){if(!policy)return null;const parts=[policy.moq&&"MOQ "+policy.moq,policy.trial_quantity&&"Trial "+policy.trial_quantity,policy.price_min!=null&&policy.price_max!=null&&((policy.currency||"USD")+" "+policy.price_min+"–"+policy.price_max),policy.lead_time_days&&policy.lead_time_days+"d lead time"].filter(Boolean);return <Info title="商业条件"><div className="policy-summary">{parts.map(x=><span key={String(x)}>{x}</span>)}</div>{policy.sample_policy&&<p className="copy compact">{policy.sample_policy}</p>}</Info>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function Metric({t,v,dark=false}:{t:string;v:string|number;dark?:boolean}){return <div className={"metric "+(dark?"dark":"")}><span>{t}</span><b>{v}</b></div>}
function Info({title,children}:{title:string;children:ReactNode}){return <section className="info"><header><b>{title}</b><Icon n="dots"/></header>{children}</section>}
function Row({k,v}:{k:string;v:string}){return <div className="row"><span>{k}</span><b>{v}</b></div>}
function Muted({children}:{children:ReactNode}){return <span className="muted">{children}</span>}
function MediaView({src,initials,className}:{src:string;initials:string;className:string}){const real=src.startsWith("http")||src.startsWith("data:")||src.startsWith("blob:");return real?<img src={src} alt={initials} className={className+" real-media"}/>:<div className={className+" media-fallback "+src}><b>{initials}</b></div>}
function emptyProduct():DraftProduct{return{id:"",title:"",subtitle:"",handle:"",description:"",status:"draft",thumbnail:"",images:[],options:[],variants:[],material:"",origin_country:"",categories:[],tags:[],metadata:{}}}
function emptyContext(id:string):ProductContext{return{id:"ctx-"+id,product_id:id,status:"incomplete",readiness_score:0,buyer_profile:"",target_markets:[],use_cases:[],selling_points:[],evidence:[],commercial_policy:{currency:"USD"},missing_evidence:[],agent_summary:""}}
function cloneProduct(p:Product):DraftProduct{return{...p,images:(p.images||[]).map(x=>({...x})),options:(p.options||[]).map(x=>({...x,values:[...x.values],value_ids:x.value_ids?.map(v=>({...v}))})),variants:(p.variants||[]).map(x=>({...x,options:{...(x.options||{})},prices:x.prices?.map(pr=>({...pr}))}))}}
function cloneContext(c:ProductContext):ProductContext{return{...c,target_markets:[...(c.target_markets||[])],use_cases:[...(c.use_cases||[])],selling_points:[...(c.selling_points||[])],missing_evidence:[...(c.missing_evidence||[])],evidence:(c.evidence||[]).map(x=>({...x})),commercial_policy:c.commercial_policy?{...c.commercial_policy}:null}}
function splitValues(v:string){return[...new Set(v.split(",").map(x=>x.trim()).filter(Boolean))]}
function defaultVariantOptions(options:ProductOption[]){return Object.fromEntries(options.filter(o=>o.title&&o.values.length).map(o=>[o.title,o.values[0]]))}
async function prepareImages(d:DraftProduct,client:MedusaClient,mode:"demo"|"live"):Promise<DraftProduct>{const queued=d.images.filter(x=>x.file);if(!queued.length)return d;if(mode==="demo")return{...d,thumbnail:d.images[0]?.url||""};const uploads=await client.uploadFiles(queued.map(x=>x.file!));let cursor=0;const images=d.images.map(x=>x.file?{id:undefined,url:uploads.files[cursor++].url}:x);return{...d,images,thumbnail:images[0]?.url||""}}
async function fileDataUrl(file:File){return await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error("图片读取失败"));r.readAsDataURL(file)})}
function contextPayload(c:ProductContext){return{status:c.status,readiness_score:c.readiness_score,buyer_profile:c.buyer_profile||undefined,target_markets:c.target_markets||[],use_cases:c.use_cases||[],selling_points:c.selling_points||[],evidence:c.evidence||[],commercial_policy:c.commercial_policy||undefined,missing_evidence:c.missing_evidence||[],agent_summary:c.agent_summary||undefined,review_version:c.review_version||1,notes:c.notes||undefined}}
function variantCreatePayload(v:ProductVariant){return{title:v.title.trim(),sku:v.sku||undefined,options:v.options||{},prices:(v.prices||[]).map(p=>({currency_code:p.currency_code,amount:Number(p.amount)})).length?(v.prices||[]).map(p=>({currency_code:p.currency_code,amount:Number(p.amount)})):[{currency_code:"usd",amount:0}]}}
function commerceReadiness(p:Product){let s=35;if(p.description)s+=15;if(p.material)s+=10;if(p.images?.length)s+=10;if(p.options?.length)s+=10;if(p.variants?.length)s+=20;return Math.min(100,s)}
function price(p?:ProductPrice){return p?new Intl.NumberFormat("en-US",{style:"currency",currency:p.currency_code.toUpperCase()}).format(p.amount):"—"}


function validStatus(value:string):ProductStatus{return(["draft","proposed","published","rejected"] as ProductStatus[]).includes(value as ProductStatus)?value as ProductStatus:"draft"}
function validContextStatus(value:string):ProductContext["status"]{return(["incomplete","ready_for_review","approved","blocked"] as ProductContext["status"][]).includes(value as ProductContext["status"])?value as ProductContext["status"]:"incomplete"}
function parseBool(value:string,fallback:boolean){const v=value.trim().toLowerCase();if(!v)return fallback;if(["true","1","yes","y"].includes(v))return true;if(["false","0","no","n"].includes(v))return false;throw Error("布尔字段无效："+value)}
function splitPipe(value:string){return[...new Set(value.split("|").map(x=>x.trim()).filter(Boolean))]}
function titleForVariant(row:CatalogImportRow){return row["Product Title"]+" Variant"}
function downloadText(text:string,name:string){const blob=new Blob(["\uFEFF"+text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
function Icon({n}:{n:string}){const m:Record<string,ReactNode>={
box:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="m3 9 9 4 9-4"/><path d="M12 13v7"/></>,
grid:<><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
folder:<path d="M3 8a3 3 0 0 1 3-3h4l2 2h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/>,
warehouse:<><path d="m3 10 9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 21v-7h8v7M7 10h.01M12 10h.01M17 10h.01"/></>,
spark:<path d="m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>,
arrow:<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
menu:<path d="M4 7h16M4 12h16M4 17h16"/>,
plus:<><path d="M12 5v14M5 12h14"/></>,
search:<><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
alert:<><path d="m12 3 9 17H3z"/><path d="M12 9v4M12 17h.01"/></>,
back:<><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
chevron:<path d="m9 5 7 7-7 7"/>,
dots:<><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></>,
close:<><path d="m6 6 12 12M18 6 6 18"/></>,
upload:<><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
download:<><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></>,
sliders:<><path d="M4 7h8M16 7h4M4 17h3M11 17h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
image:<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 5"/></>,
edit:<><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m13.5 7.5 3 3"/></>,
trash:<><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
up:<><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></>,
down:<><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></>,
lock:<><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
check:<><path d="m5 12 4 4L19 6"/></>
};return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{m[n]}</svg>}
