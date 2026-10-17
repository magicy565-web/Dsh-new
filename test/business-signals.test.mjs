import test from 'node:test';
import assert from 'node:assert/strict';
import {extractBusinessSignals,rankBusinessSignals} from '../plugins/workspace-goal-intelligence/src/signals.mjs';
const ref=id=>({kind:'metric',id,revision:'1',sha256:'x',fields:['inquiries']});
test('does not invent missing metrics',()=>{const s=extractBusinessSignals([{evidenceId:'m',reference:ref('m'),values:{inquiries:10}}]);assert.equal(s.some(x=>x.type==='sales'),false)});
test('flags overdue followup',()=>{const now=Date.parse('2026-10-16T10:00:00Z');const s=extractBusinessSignals([{evidenceId:'m',reference:ref('m'),values:{lastFollowupAt:'2026-10-10T10:00:00Z',followupDueAt:'2026-10-15T10:00:00Z'}}],{now:()=>now});assert.equal(s[0].id,'m:followup')});
test('keeps unknown and pending explicit',()=>{const s=extractBusinessSignals([{evidenceId:'m',reference:ref('m'),values:{inquiries:20,unknownResults:3,pendingResults:4}}]);assert.deepEqual(s.map(x=>x.gaps[0]).sort(),['PENDING_OUTCOMES','UNKNOWN_OUTCOMES'])});
test('ranks by evidence priority only',()=>{const s=rankBusinessSignals([{id:'a',priority:80},{id:'b',priority:95},{id:'c',priority:90}],2);assert.deepEqual(s.map(x=>x.id),['b','c'])});