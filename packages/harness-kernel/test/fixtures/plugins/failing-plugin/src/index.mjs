import { trace } from '../../../lib.mjs';

export function apply() {
  trace('apply', 'failing-plugin');
  throw new Error('boom from failing-plugin');
}
