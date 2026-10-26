import { reviewInSession } from './browser-review.js';
import { compileDraft, inspectIssue, MAX_INPUT_BYTES } from './core.js';
import { generateInSession } from './native-files.js';

const parameters = { type: 'object', properties: { issueJson: { type: 'string', maxLength: MAX_INPUT_BYTES } },
  required: ['issueJson'], additionalProperties: false };
function input(args) {
  if (!args || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'issueJson')) return undefined;
  return args.issueJson;
}
export function magazineTools(ctx, config = {}) {
  return [
    {
      name: 'buyer_magazine_validate_issue',
      description: 'Validate complete Studio issue JSON for a draft procurement magazine. Collection belongs to existing DSH web/file tools and Skill. Never grants image rights, supplier verification, purchasing approval, or permission to send.',
      parameters,
      output: { schema: { type: 'object', properties: { valid: { type: 'boolean' }, errorCount: { type: 'integer' }, warningCount: { type: 'integer' }, issues: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, code: { type: 'string' } }, required: ['path', 'code'], additionalProperties: false } } }, required: ['valid', 'errorCount', 'warningCount', 'issues'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        if (exec?.signal?.aborted) compileDraft(input(args), { signal: exec.signal });
        const { valid, errorCount, warningCount, issues } = inspectIssue(input(args));
        return { valid, errorCount, warningCount, issues };
      },
    },
    {
      name: 'buyer_magazine_generate',
      description: 'Validate and deterministically generate a draft procurement magazine HTML in the current native Session workspace. Uses current file policy, create-only writes, and safe content-derived filenames. Returns an incomplete draft with explicit design blockers. Run buyer_magazine_review, inspect screenshots and repair defects before claiming completion. Draft preview is allowed; use official present for the exact path. This tool does not present, contact anyone, collect websites, verify facts or image rights, approve purchases, or change permissions.',
      parameters,
      output: { schema: { type: 'object', properties: {
        path: { type: 'string' }, name: { type: 'string' }, bytes: { type: 'integer' }, sha256: { type: 'string' },
        readiness: { type: 'object', properties: {status:{type:'string'},blockers:{type:'array',items:{type:'string'}}}, required:['status','blockers'],additionalProperties:false },
        status: { type: 'string', enum: ['generated'] }, presentation: { type: 'string', enum: ['pending-official-present'] },
        reused: { type: 'boolean' }, draftOnly: { type: 'boolean', enum: [true] }, externalImageCount: { type: 'integer' }, warningCount: { type: 'integer' },
      }, required: ['path', 'name', 'bytes', 'sha256', 'status', 'presentation', 'reused', 'draftOnly', 'externalImageCount', 'warningCount', 'readiness'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        return generateInSession(ctx, input(args), exec);
      },
    },
    {
      name: 'buyer_magazine_review',
      description: 'Render the exact compiler output in Chromium and return real screenshots to the current native image-capable model. Checks responsive geometry, image loading and interactions. Use overview, spreads/products (three at a time; follow nextSpreadStart/nextProductStart), editorial and print (actual PDF pages; follow nextPrintStart). For flip-state spread screenshots set readingMode:flip. For full mobile spread review set width:375 and follow both batches. Inspect every returned image; observed is not aesthetic approval. Editorial also returns a native PDF attachment. Does not browse arbitrary URLs, run model-supplied code, publish or send.',
      parameters: {type:'object',properties:{issueJson:{type:'string',maxLength:MAX_INPUT_BYTES},view:{type:'string',enum:['overview','spreads','products','editorial','print']},start:{type:'integer',minimum:0,maximum:23},width:{type:'integer',enum:[375,768,1440]},readingMode:{type:'string',enum:['scroll','flip']}},required:['issueJson','view'],additionalProperties:false},
      output: {schema:{type:'object',properties:{status:{type:'string'},sha256:{type:'string'},screenshots:{type:'array'}},required:['status','sha256','screenshots'],additionalProperties:true},
        render: (_args,value) => [{type:'text',text:JSON.stringify({...value,screenshots:value.screenshots.map(s=>({label:s.label,attachmentId:s.attachment.attachmentId}))})},...value.screenshots.map(s=>({type:'image',attachment:s.attachment})),...(value.pdf?[{type:'file',attachment:value.pdf}]:[])]},
      async execute(args,exec) {return reviewInSession(ctx,args,exec,config);},
    },
  ];
}
