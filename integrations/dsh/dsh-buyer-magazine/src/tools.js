import { compileDraft, inspectIssue, MAX_INPUT_BYTES } from './core.js';
import { generateInSession } from './native-files.js';

const parameters = { type: 'object', properties: { issueJson: { type: 'string', maxLength: MAX_INPUT_BYTES } },
  required: ['issueJson'], additionalProperties: false };
function input(args) {
  if (!args || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'issueJson')) return undefined;
  return args.issueJson;
}
export function magazineTools(ctx) {
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
      description: 'Validate and deterministically generate a draft procurement magazine HTML in the current native Session workspace. Uses current file policy, create-only writes, and safe content-derived filenames. After success call the existing official present tool with the returned path. This tool does not present, contact anyone, collect websites, verify facts or image rights, approve purchases, or change permissions.',
      parameters,
      output: { schema: { type: 'object', properties: {
        path: { type: 'string' }, name: { type: 'string' }, bytes: { type: 'integer' }, sha256: { type: 'string' },
        status: { type: 'string', enum: ['generated'] }, presentation: { type: 'string', enum: ['pending-official-present'] },
        reused: { type: 'boolean' }, draftOnly: { type: 'boolean', enum: [true] }, externalImageCount: { type: 'integer' }, warningCount: { type: 'integer' },
      }, required: ['path', 'name', 'bytes', 'sha256', 'status', 'presentation', 'reused', 'draftOnly', 'externalImageCount', 'warningCount'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        return generateInSession(ctx, input(args), exec);
      },
    },
  ];
}
