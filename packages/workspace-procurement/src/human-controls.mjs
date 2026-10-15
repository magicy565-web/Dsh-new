import { identifier, requestIdentifier, taskInput, validatePublicBusinessInput } from './workspace.mjs';

// Ordinary official Pi/OMP command registration only. Models never receive
// approval/cancel/resume tools; original HTTP APIs own every decision and run.
export function registerWorkspaceHumanControls(pi, client, configuration = 'configured_unverified') {
  const show = value => pi.sendMessage({ customType: 'workspace-original-control', content: JSON.stringify(value, null, 2), display: true, details: {} });
  const command = (name, description, operation) => pi.registerCommand(name, { description, handler: async (args, ctx) => {
    if (configuration === 'unconfigured' || !client) { show({ status: 'unconfigured', reason: 'EXISTING_WORKSPACE_BINDING_REQUIRED' }); return; }
    try { show(await operation(args, ctx)); } catch (error) { ctx.ui.notify(error.message, 'error'); }
  } });
  const confirm = async (ctx, title, receipt) => {
    if (!ctx.hasUI || typeof ctx.ui?.confirm !== 'function') throw new Error('This operation requires a visible human confirmation in the Workspace terminal. No mutation was sent.');
    return await ctx.ui.confirm(title, typeof receipt === 'string' ? receipt : JSON.stringify(receipt, null, 2)) === true;
  };
  const taskSummary = (taskId, receipt) => {
    const task = receipt.task;
    const stages = task.workspace?.runIds || (task.steps || []).filter(step => step.runId).map(step => step.runId);
    const documents = (receipt.sources || []).filter(file => file.kind === 'artifact' && file.sha256).map(file => `${file.name}: ${file.sha256}`);
    return [`Original task: ${taskId}`, `Type: ${task.type || 'business'}; status: ${task.status}`,
      'Only the unchanged original task is controlled; no replacement task is submitted.',
      `Budget: ${task.budget ? JSON.stringify(task.budget) : 'not included in this receipt; original allowance is preserved'}`, `Stage Run IDs: ${stages.join('; ') || 'none reported'}`,
      ...documents.map(value => 'Saved document SHA256: ' + value)].join('\n');
  };
  const fields = (args, count) => { const values = args.trim().split(/\s+/); if (values.length !== count) throw new Error('Supply the exact original IDs and one stable requestId when required.'); return values; };
  command('ws-status', 'Read original run: /ws-status RUN_ID', args => client.status(identifier(args.trim())));
  command('ws-business-status', 'Read original task and saved document hashes: /ws-business-status TASK_ID', args => client.businessStatus(identifier(args.trim())));
  command('ws-task', 'Human submit public task: /ws-task {"title":"...","content":"...","requestId":"stable-key"}', async (args, ctx) => {
    let input; try { input = JSON.parse(args); } catch { throw new Error('Use explicit public task JSON.'); }
    requestIdentifier(input?.requestId); validatePublicBusinessInput(input);
    const admitted = taskInput(input);
    if (admitted.connectorActions?.length) throw new Error('This public factory entry does not authorize external connector actions.');
    if (!await confirm(ctx, 'Submit this exact public task to the original Workspace?', admitted)) return { submitted: false };
    return client.submit(admitted);
  });
  command('ws-cancel', 'Cancel original run: /ws-cancel RUN_ID', async (args, ctx) => {
    const runId = identifier(args.trim()), receipt = await client.status(runId);
    if (!await confirm(ctx, 'Cancel this original Workspace run?', { runId, status: receipt.status, budget: receipt.budget })) return { runId, cancelled: false };
    return client.cancel(runId);
  });
  command('ws-resume', 'Recover original checkpoint: /ws-resume RUN_ID STABLE_REQUEST_ID', async (args, ctx) => {
    const [id, key] = fields(args, 2), runId = identifier(id), requestId = requestIdentifier(key), receipt = await client.status(runId);
    if (receipt.status !== 'interrupted') throw new Error('Only an interrupted original checkpoint can recover; no replacement run was submitted.');
    if (!await confirm(ctx, 'Recover this unchanged original checkpoint?', { runId, requestId, status: receipt.status, budget: receipt.budget })) return { runId, resumed: false };
    return client.resume(runId, requestId);
  });
  command('ws-approve', 'Review exact original proposal: /ws-approve RUN_ID PROPOSAL_ID', async (args, ctx) => {
    const [id, proposalId] = fields(args, 2), runId = identifier(id); identifier(proposalId);
    const receipt = await client.status(runId), proposal = receipt.proposals?.find(row => row.id === proposalId);
    if (!proposal) throw new Error('Exact original proposal is unavailable; no approval was sent.');
    if (!await confirm(ctx, 'Approve this exact original Workspace proposal?', proposal)) return { runId, proposalId, approved: false };
    return client.decision(runId, proposalId, 'approved');
  });
  command('ws-continue', 'Continue approved action: /ws-continue RUN_ID PROPOSAL_ID STABLE_REQUEST_ID', async (args, ctx) => {
    const [id, proposalId, key] = fields(args, 3), runId = identifier(id), requestId = requestIdentifier(key); identifier(proposalId);
    const receipt = await client.status(runId), proposal = receipt.proposals?.find(row => row.id === proposalId);
    if (!proposal) throw new Error('Exact original proposal is unavailable; no continuation was sent.');
    if (!await confirm(ctx, 'Continue this exact approved original action?', { runId, requestId, proposal, budget: receipt.budget })) return { runId, continued: false };
    return client.continue(runId, proposalId, requestId);
  });
  command('ws-business-cancel', 'Cancel original business task: /ws-business-cancel TASK_ID', async (args, ctx) => {
    const taskId = identifier(args.trim()), receipt = await client.businessStatus(taskId);
    if (!await confirm(ctx, 'Cancel this original business task?', taskSummary(taskId, receipt))) return { taskId, cancelled: false };
    return client.businessCancel(taskId);
  });
  command('ws-business-resume', 'Recover original task: /ws-business-resume TASK_ID STABLE_REQUEST_ID', async (args, ctx) => {
    const [id, key] = fields(args, 2), taskId = identifier(id), requestId = requestIdentifier(key), receipt = await client.businessStatus(taskId);
    if (!receipt.task.result?.resumable || !['failed', 'interrupted'].includes(receipt.task.status)) throw new Error('Original task has no eligible checkpoint; no continuation was sent.');
    if (!await confirm(ctx, 'Recover this unchanged original business task?', taskSummary(taskId, receipt))) return { taskId, resumed: false };
    return client.businessResume(taskId, undefined, requestId);
  });
}
