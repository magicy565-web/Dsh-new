import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOT_MCP_TOOLS } from '../server/dot-mcp-tools.mjs';

test('bundled production MCP schemas match the reviewed 11-action REST tool contract', async () => {
  const spec = JSON.parse(await readFile(
    new URL('../docs/dot-worker-openapi.json', import.meta.url), 'utf8'));
  const expected = new Map;
  for (const path of Object.values(spec.paths)) {
    const action = path.get || path.post;
    if (!action) continue;
    const properties = {};
    const required = [];
    for (const param of action.parameters || []) {
      properties[param.name] = param.schema;
      if (param.required) required.push(param.name);
    }
    const body = action.requestBody?.content?.['application/json']?.schema;
    if (body) {
      Object.assign(properties, body.properties || {});
      required.push(...(body.required || []));
    }
    expected.set(action.operationId, { type: 'object', properties, required,
      additionalProperties: false });
  }
  assert.equal(DOT_MCP_TOOLS.length, 11);
  assert.equal(new Set(DOT_MCP_TOOLS.map(t => t.name)).size, 11);
  assert.equal(expected.size, 11);
  assert.deepEqual(DOT_MCP_TOOLS.map(t => t.name).sort(), [...expected.keys()].sort());
  for (const tool of DOT_MCP_TOOLS) {
    assert.deepEqual(tool.inputSchema, expected.get(tool.name));
    assert.ok(tool.description.includes('No implied authority'));
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
  }
});

test('runtime MCP module is self-contained and does not depend on nonpackaged documentation files', async () => {
  const content = await readFile(new URL('../server/dot-mcp-server.mjs', import.meta.url), 'utf8');
  assert.ok(content.includes("import { DOT_MCP_TOOLS } from './dot-mcp-tools.mjs'"));
  assert.equal(content.includes('readFileSync'), false);
  assert.equal(content.includes("import '../docs/"), false);
});
