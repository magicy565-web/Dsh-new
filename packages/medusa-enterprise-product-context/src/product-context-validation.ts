import {z} from "@medusajs/framework/zod"

// The existing migration stores review_version as PostgreSQL integer, not bigint.
export const MAX_REVIEW_VERSION=2147483647
export const EvidenceSchema=z.object({
  id:z.string().min(1).max(120),label:z.string().min(1).max(200),
  type:z.enum(["certificate","test_report","case_study","spec_sheet","other"]),
  status:z.enum(["verified","pending","missing"]),source:z.string().max(1000).optional(),
  sha256:z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),reviewed_at:z.string().datetime().optional(),
}).strict()
export const CommercialPolicySchema=z.object({
  moq:z.number().finite().nonnegative().optional(),trial_quantity:z.number().finite().nonnegative().optional(),
  currency:z.string().max(10).optional(),price_min:z.number().finite().nonnegative().optional(),
  price_max:z.number().finite().nonnegative().optional(),lead_time_days:z.number().int().nonnegative().optional(),
  sample_policy:z.string().max(1000).optional(),
}).strict()
export const ContextContentSchema=z.object({
  readiness_score:z.number().min(0).max(100),buyer_profile:z.string().max(2000).nullable(),
  target_markets:z.array(z.string().min(1).max(120)).max(50),
  use_cases:z.array(z.string().min(1).max(160)).max(50),
  selling_points:z.array(z.string().min(1).max(500)).max(50),
  evidence:z.array(EvidenceSchema).max(100).nullable(),commercial_policy:CommercialPolicySchema.nullable(),
  missing_evidence:z.array(z.string().min(1).max(240)).max(50),agent_summary:z.string().max(5000).nullable(),
})
export const ProductContextInputSchema=ContextContentSchema.partial().extend({
  status:z.enum(["incomplete","ready_for_review","approved","blocked"]).optional(),
  source_hash:z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/).optional(),
  review_version:z.number().int().min(0).max(MAX_REVIEW_VERSION),notes:z.string().max(5000).nullable().optional(),
})
export type ProductContextInput=z.infer<typeof ProductContextInputSchema>
export const ProductSourceSchema=z.object({
  id:z.string().min(1),title:z.string(),subtitle:z.string().nullable().optional(),
  handle:z.string().nullable().optional(),description:z.string().nullable().optional(),
  status:z.string().optional(),thumbnail:z.string().nullable().optional(),
  variants:z.array(z.object({id:z.string().min(1),title:z.string().nullable().optional(),sku:z.string().nullable().optional()})).optional(),
})
