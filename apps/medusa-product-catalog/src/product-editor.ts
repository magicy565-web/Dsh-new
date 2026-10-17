import type {Product} from './catalog'

// Existing projections can omit option assignments and prices. Editing another
// field must never invent defaults or normalize unrelated persisted fields.
export function sanitizeProductDraft<T extends Product>(draft:T):T {
  if(draft.id)return draft
  const options=(draft.options||[]).map(o=>({...o,title:o.title.trim(),values:[...new Set(o.values.map(v=>v.trim()).filter(Boolean))]})).filter(o=>o.title&&o.values.length)
  const variants=(draft.variants||[]).map(v=>{
    const assignments:Record<string,string>={}
    for(const option of options){const value=v.options?.[option.title];assignments[option.title]=value&&option.values.includes(value)?value:option.values[0]}
    return {...v,title:v.title.trim(),options:assignments}
  })
  return {...draft,images:(draft.images||[]).filter(image=>image.url),options,variants}
}
