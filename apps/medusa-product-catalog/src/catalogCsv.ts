import type {Product,ProductContext} from "./catalog"

export const CATALOG_CSV_HEADERS=[
  "Product Id","Product Handle","Product Title","Product Subtitle","Product Status","Product Description",
  "Product Material","Product Origin Country","Product Thumbnail","Product Images","Product Collection Id",
  "Product Category Ids","Product Sales Channel Ids","Variant Id","Variant Title","Variant SKU","Variant Options",
  "Variant Price","Variant Prices","Variant Currency","Variant Manage Inventory","Variant Allow Backorder",
  "Agent Status","Agent Readiness","Agent Buyer Profile","Agent Markets","Agent Use Cases",
  "Agent Selling Points","Agent Missing Evidence","Agent Evidence","Agent Commercial Policy","Agent Summary"
] as const

export type CatalogImportRow=Record<typeof CATALOG_CSV_HEADERS[number],string>

export function catalogCsv(products:Product[],contexts:Record<string,ProductContext>={}){
  const rows:string[][]=[]
  for(const p of products){
    const variants=p.variants?.length?p.variants:[{id:"",title:"",sku:"",options:{},prices:[]}]
    for(const v of variants){
      const c=contexts[p.id]
      rows.push([
        p.id,p.handle,p.title,p.subtitle||"",p.status,p.description||"",p.material||"",p.origin_country||"",
        p.thumbnail||"",(p.images||[]).map(x=>x.url).join("|"),p.collection_id||"",
        (p.categories||[]).map(x=>x.id).join("|"),(p.sales_channels||[]).map(x=>x.id).join("|"),
        v.id,v.title,v.sku||"",JSON.stringify(v.options||{}),String(v.prices?.[0]?.amount??""),JSON.stringify(v.prices||[]),
        v.prices?.[0]?.currency_code||"usd",String(v.manage_inventory??true),String(v.allow_backorder??false),
        c?.status||"",String(c?.readiness_score??""),c?.buyer_profile||"",
        (c?.target_markets||[]).join("|"),(c?.use_cases||[]).join("|"),(c?.selling_points||[]).join("|"),
        (c?.missing_evidence||[]).join("|"),JSON.stringify(c?.evidence||[]),JSON.stringify(c?.commercial_policy||{}),c?.agent_summary||""
      ])
    }
  }
  return [CATALOG_CSV_HEADERS.map(csvCell).join(","),...rows.map(r=>r.map(csvCell).join(","))].join("\r\n")+"\r\n"
}

export function parseCatalogCsv(text:string):CatalogImportRow[]{
  const cells=parseCsv(text.replace(/^\uFEFF/,""))
  if(!cells.length)return[]
  const header=cells[0].map(x=>x.trim())
  const indexes=new Map(header.map((x,i)=>[x,i]))
  const missing=CATALOG_CSV_HEADERS.filter(x=>!indexes.has(x))
  if(missing.length)throw Error("CSV 缺少字段："+missing.join("、"))
  return cells.slice(1).filter(row=>row.some(x=>x.trim())).map(row=>{
    const out={} as CatalogImportRow
    for(const key of CATALOG_CSV_HEADERS)out[key]=row[indexes.get(key)!]??""
    return out
  })
}

function csvCell(value:string){const v=String(value??"");return/[",\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v}

function parseCsv(text:string){
  const rows:string[][]=[];let row:string[]=[];let cell="";let quoted=false
  for(let i=0;i<text.length;i++){
    const ch=text[i]
    if(quoted){
      if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=ch
    }else{
      if(ch==='"'&&cell===""){quoted=true}
      else if(ch===","){row.push(cell);cell=""}
      else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell=""}
      else if(ch==="\r"){if(text[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell=""}
      else cell+=ch
    }
  }
  if(cell!==""||row.length){row.push(cell);rows.push(row)}
  return rows
}
