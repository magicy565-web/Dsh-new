import {defineLink} from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ProductContextModule from "../modules/product-context"

// Product Context owns the existing product_id column. Both graph directions
// are read-only joins; neither definition introduces a link table or writes.
defineLink(
  {linkable:ProductModule.linkable.product,field:"id"},
  {...ProductContextModule.linkable.productContext.id,primaryKey:"product_id",alias:"product_context"},
  {readOnly:true}
)
export default defineLink(
  {linkable:ProductContextModule.linkable.productContext,field:"product_id"},
  ProductModule.linkable.product,
  {readOnly:true}
)
