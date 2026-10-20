// Node 24's test runner treats positional arguments as glob patterns; a bare
// directory argument only works when it resolves to a loadable module. Importing
// the suites here makes the contract's acceptance command
//   node --test packages/harness-seams/test
// run the full suite. The glob form
//   node --test "packages/harness-seams/test/*.test.mjs"
// runs the same files directly and does not load this aggregator.
import './storage.test.mjs';
import './approval.test.mjs';
import './tools.test.mjs';
import './artifacts.test.mjs';
import './llm.test.mjs';
import './skills.test.mjs';
import './integration.test.mjs';
