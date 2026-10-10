import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production expert center ships actual distinct semantic vector role icons, not initials avatars',async()=>{
  const source=await readFile(new URL('../src/expert-icons.tsx',import.meta.url),'utf8');
  const templates=['growth-lead','buyer-hunter','market-analyst','channel-planner',
    'sales-specialist','brand-designer','commerce-tester','rfq-analyst'];
  for(const role of templates) {
    const escaped=role.replaceAll('-','\\-');
    assert.match(source,new RegExp("'"+escaped+"': <>"));
  }
  assert.equal((source.match(/'([a-z-]+)': <>/g)||[]).length,8);
  assert.ok((source.match(/<path /g)||[]).length>12);
  assert.ok((source.match(/<circle /g)||[]).length>8);
  assert.equal(source.includes('>{label}</span>'),false);
  assert.ok(source.includes('glyphs[role]'));
});

test('expert screen reads actual connected enterprise tools and renders meaningful SOP/deliverables',async()=>{
  const code=await readFile(new URL('../src/CloudExperts.tsx',import.meta.url),'utf8');
  assert.ok(code.includes("api<{connectors:Connector[]}>('/connectors')"));
  assert.ok(code.includes("api<{skills:WorkspaceSkill[]}>('/skills')"));
  assert.ok(code.includes("currentTemplate.brief.deliverables.map"));
  assert.ok(code.includes("currentTemplate.brief.steps.map"));
  assert.ok(code.includes('onManageTools'));
  assert.ok(code.includes('expert-mark')===false,'role icon rendering is owned by ExpertMark, not fake HTML text');
  assert.ok(code.includes('stageTeamWork')===false,'frontend delegates actual staging to authenticated backend API');
  assert.ok(code.includes("'/cloud-teams/'+plan.teamId+'/stage'"));
});
