import {MedusaService,MedusaError,toMikroORMEntity} from "@medusajs/framework/utils"
import type {DAL} from "@medusajs/framework/types"
import type {EntityManager} from "@medusajs/framework/mikro-orm/postgresql"
import {ProductContext} from "./models/product-context"

export default class ProductContextModuleService extends MedusaService({ProductContext}){
  private readonly reviewRepository_:DAL.RepositoryService
  constructor(container:any){
    super(container)
    this.reviewRepository_=container.baseRepository
  }

  // Generated updateProductContexts reads then assigns; a selector there is not CAS.
  // The stored hash also fences writes once the integer version has saturated.
  async updateReviewedProductContext(id:string,version:number,input:Record<string,any>,expectedSourceHash:string|null){
    if(expectedSourceHash!==null&&typeof expectedSourceHash!=="string")throw new MedusaError(MedusaError.Types.CONFLICT,"Expected source revision required.")
    const manager=this.reviewRepository_.getFreshManager<EntityManager>()
    const entity=toMikroORMEntity(ProductContext)
    const changed=await manager.nativeUpdate(entity,{id,review_version:version,deleted_at:null,source_hash:expectedSourceHash},{...input,updated_at:new Date()})
    if(changed!==1)throw new MedusaError(MedusaError.Types.CONFLICT,"Product Context changed; reload before reviewing.")
    return this.retrieveProductContext(id)
  }
}
