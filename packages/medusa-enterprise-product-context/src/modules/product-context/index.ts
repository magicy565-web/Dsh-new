import {Module} from "@medusajs/framework/utils"
import ProductContextModuleService from "./service"
export const PRODUCT_CONTEXT_MODULE="product_context"
export default Module(PRODUCT_CONTEXT_MODULE,{service:ProductContextModuleService})
