// Public deterministic API: no SDK import, storage, session, network or presentation.
export { compileDraft, MAX_INPUT_BYTES, MAX_HTML_BYTES } from './src/core.js';
import { inspectIssue } from './src/core.js';

export function validateIssueJson(issueJson, options) {
  const { valid, errorCount, warningCount, issues, stats } = inspectIssue(issueJson, options);
  return { valid, errorCount, warningCount, issues, stats };
}
