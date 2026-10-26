import { HarnessError } from '@deepseek-ai/dsh-llm';
import { magazineTools } from './src/tools.js';
import { failure } from './src/core.js';

export const name = 'dsh-buyer-magazine';
export const inject = ['tools', 'fs', 'workingDirectory', 'sandboxPolicy'];
export function apply(ctx, config = {}) {
  for (const tool of magazineTools(ctx, config)) {
    ctx.tools.register({
      ...tool,
      async execute(args, exec) {
        try { return await tool.execute(args, exec); }
        catch (error) {
          // Only our fixed, internally-created error messages cross the native boundary.
          const known = failure(error);
          throw new HarnessError(known.message, known.code);
        }
      },
    });
  }
}
