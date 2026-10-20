// The approved tool registry. The model (or the rule planner) can only ask for tools listed here; the backend validates the input,
// checks permissions, asks the person when needed, runs the tool, then re-reads the state to verify the result.
// Risk levels:  read = safe, runs by itself.   write = changes NOVA's own data, reversible; needs approval unless the person turned on "auto-approve low risk".
//               destructive = needs approval every time.   external = affects another system; needs approval every time, never auto-approved.
'use strict';

const RISKS = ['read', 'write', 'destructive', 'external'];
const date = ms => new Date(ms).toISOString().slice(0, 10);

function createRegistry(deps) {
  const { db, memory, pl } = deps;
  const tools = new Map();

  function register(t) {
    if (!/^[a-z]+\.[a-z_]+$/.test(t.name)) throw new Error('bad tool name ' + t.name);
    if (!RISKS.includes(t.risk)) throw new Error('bad risk for ' + t.name);
    if (!t.schema || t.schema.type !== 'object') throw new Error('tool needs an object schema: ' + t.name);
    if (typeof t.run !== 'function' || typeof t.preview !== 'function' || typeof t.summarize !== 'function') throw new Error('tool is incomplete: ' + t.name);
    if (t.risk !== 'read' && typeof t.verify !== 'function') throw new Error('state-changing tools must verify their result: ' + t.name);
    if (tools.has(t.name)) throw new Error('duplicate tool ' + t.name);
    tools.set(t.name, t);
  }
  const taskRow = (userId, id) => db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId);

  register({ name: 'ask.clarify', risk: 'read', description: 'Ask the owner ONE short question when the request is ambiguous, incomplete or you are not sure. Use this instead of guessing.', schema: { type: 'object', required: ['question'], properties: { question: { type: 'string', minLength: 3, maxLength: 300 } } },
    preview: () => ({ action: 'Ask you a question', target: 'NOVA chat', changes: [], consequences: 'Nothing changes.', undoable: true }),
    run: (ctx, i) => ({ question: i.question.trim() }), summarize: o => o.question });

  register({ name: 'time.now', risk: 'read', description: 'Current date and time in Dubai.', schema: { type: 'object', properties: {} },
    preview: () => ({ action: 'Read the clock', target: 'NOVA server', changes: [], consequences: 'Nothing changes.', undoable: true }),
    run: ctx => ({ iso: new Date(ctx.now()).toISOString(), dubai: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'full', timeStyle: 'short' }).format(new Date(ctx.now())) }),
    summarize: o => 'It is ' + o.dubai + ' in Dubai.' });

  register({ name: 'tasks.list', risk: 'read', description: 'List the owner\'s tasks.', schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'] } } },
    preview: () => ({ action: 'List your tasks', target: 'NOVA tasks', changes: [], consequences: 'Nothing changes.', undoable: true }),
    run: (ctx, i) => ({ tasks: db.prepare("SELECT id, title, due, status FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND (? = 'all' OR status = ?) ORDER BY (due IS NULL), due, id LIMIT 50").all(ctx.user.id, i.status || 'open', i.status || 'open') }),
    summarize: o => o.tasks.length ? 'You have ' + o.tasks.length + (o.tasks.length === 1 ? ' task: ' : ' tasks: ') + o.tasks.map(t => t.title + (t.due ? ' (due ' + t.due + ')' : '')).join('; ') + '.' : 'You have no matching tasks.' });

  register({ name: 'tasks.create', risk: 'write', description: 'Create a task for the owner.', schema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, due: { type: 'string', format: 'date' } } },
    preview: (ctx, i) => ({ action: 'Create a task', target: 'NOVA tasks (server database)', changes: ['New task: "' + i.title + '"' + (i.due ? ', due ' + i.due : ', no due date')], consequences: 'The task appears in your task list. Nothing is sent to anyone.', undoable: true, undoNote: 'You can undo this: the task is removed.' }),
    run: (ctx, i) => { const r = db.prepare('INSERT INTO tasks (user_id, title, due, source, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.user.id, i.title.trim(), i.due || null, 'NOVA run ' + ctx.runId, ctx.runId, ctx.now()); return { id: Number(r.lastInsertRowid), title: i.title.trim(), due: i.due || null }; },
    verify: (ctx, i, o) => { const t = taskRow(ctx.user.id, o.id); return t && t.title === o.title ? { ok: true, evidence: 'Read back from the database: task #' + t.id + ' "' + t.title + '" exists and is ' + t.status + '.' } : { ok: false, evidence: 'The task could not be found after it was created.' }; },
    undo: (ctx, o) => { db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND user_id = ?').run(ctx.now(), o.id, ctx.user.id); return 'Task #' + o.id + ' removed.'; },
    summarize: o => 'Created the task "' + o.title + '"' + (o.due ? ' (due ' + o.due + ')' : '') + '.' });

  register({ name: 'tasks.complete', risk: 'write', description: 'Mark one of the owner\'s tasks as done.', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
    preview: (ctx, i) => { const t = taskRow(ctx.user.id, i.id); return { action: 'Mark a task as done', target: 'NOVA tasks', changes: [t ? 'Task #' + t.id + ' "' + t.title + '": open → done' : 'Task #' + i.id + ' (not found)'], consequences: 'The task moves to your done list.', undoable: true, undoNote: 'You can undo this: the task is reopened.' }; },
    run: (ctx, i) => { const t = taskRow(ctx.user.id, i.id); if (!t) throw new Error('Task #' + i.id + ' was not found.'); if (t.status === 'done') throw new Error('That task is already done.'); db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND user_id = ?").run(ctx.now(), t.id, ctx.user.id); return { id: t.id, title: t.title }; },
    verify: (ctx, i, o) => { const t = taskRow(ctx.user.id, o.id); return t && t.status === 'done' ? { ok: true, evidence: 'Read back from the database: task #' + t.id + ' is done.' } : { ok: false, evidence: 'The task is not marked done after the update.' }; },
    undo: (ctx, o) => { db.prepare("UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = ? AND user_id = ?").run(o.id, ctx.user.id); return 'Task #' + o.id + ' reopened.'; },
    summarize: o => 'Marked "' + o.title + '" as done.' });

  register({ name: 'tasks.delete', risk: 'destructive', description: 'Delete one of the owner\'s tasks.', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
    preview: (ctx, i) => { const t = taskRow(ctx.user.id, i.id); return { action: 'Delete a task', target: 'NOVA tasks', changes: [t ? 'Remove task #' + t.id + ' "' + t.title + '"' : 'Task #' + i.id + ' (not found)'], consequences: 'The task disappears from your lists.', undoable: true, undoNote: 'You can undo this: the task is restored.' }; },
    run: (ctx, i) => { const t = taskRow(ctx.user.id, i.id); if (!t) throw new Error('Task #' + i.id + ' was not found.'); db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND user_id = ?').run(ctx.now(), t.id, ctx.user.id); return { id: t.id, title: t.title }; },
    verify: (ctx, i, o) => !taskRow(ctx.user.id, o.id) ? { ok: true, evidence: 'Read back from the database: task #' + o.id + ' no longer appears in your tasks.' } : { ok: false, evidence: 'The task still exists.' },
    undo: (ctx, o) => { db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ? AND user_id = ?').run(o.id, ctx.user.id); return 'Task #' + o.id + ' restored.'; },
    summarize: o => 'Deleted the task "' + o.title + '".' });

  register({ name: 'notes.create', risk: 'write', description: 'Save a note for the owner.', schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } } },
    preview: (ctx, i) => ({ action: 'Save a note', target: 'NOVA notes (server database)', changes: ['New note: "' + i.text + '"'], consequences: 'The note is saved in your account. Nothing is sent to anyone.', undoable: true, undoNote: 'You can undo this: the note is removed.' }),
    run: (ctx, i) => { const r = db.prepare('INSERT INTO notes (user_id, text, run_id, created_at) VALUES (?, ?, ?, ?)').run(ctx.user.id, i.text.trim(), ctx.runId, ctx.now()); return { id: Number(r.lastInsertRowid), text: i.text.trim() }; },
    verify: (ctx, i, o) => { const n = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(o.id, ctx.user.id); return n && n.text === o.text ? { ok: true, evidence: 'Read back from the database: note #' + n.id + ' exists.' } : { ok: false, evidence: 'The note could not be found after it was saved.' }; },
    undo: (ctx, o) => { db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ?').run(ctx.now(), o.id, ctx.user.id); return 'Note #' + o.id + ' removed.'; },
    summarize: o => 'Saved the note "' + o.text + '".' });

  register({ name: 'notes.list', risk: 'read', description: 'List the owner\'s latest notes.', schema: { type: 'object', properties: {} },
    preview: () => ({ action: 'List your notes', target: 'NOVA notes', changes: [], consequences: 'Nothing changes.', undoable: true }),
    run: ctx => ({ notes: db.prepare('SELECT id, text FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 20').all(ctx.user.id) }),
    summarize: o => o.notes.length ? 'Your latest notes: ' + o.notes.map(n => n.text).join('; ') + '.' : 'You have no notes.' });

  register({ name: 'memory.search', risk: 'read', description: 'Find saved memories relevant to a question (respects the personalisation switch).', schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 200 } } },
    preview: () => ({ action: 'Search your memories', target: 'Memory Vault', changes: [], consequences: 'Nothing changes.', undoable: true }),
    run: (ctx, i) => ({ memories: memory.retrieve(ctx.user, i.query, 5).map(m => ({ id: m.id, text: m.text, kind: m.kind })) }),
    summarize: o => o.memories.length ? 'Relevant memories: ' + o.memories.map(m => m.text).join('; ') + '.' : 'I found no relevant saved memories.' });

  register({ name: 'memory.add', risk: 'write', description: 'Save a memory the owner asked NOVA to remember.', schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 500 }, kind: { type: 'string', enum: memory.KINDS }, confirmSensitive: { type: 'boolean' } } },
    preview: (ctx, i) => { const c = memory.classify(i.text); return { action: 'Save a memory', target: 'Memory Vault', changes: ['New memory: "' + i.text + '"' + (c.sensitive ? ' (looks sensitive: ' + (c.blocked || c.why) + ')' : '')], consequences: 'NOVA may use it to answer later requests while personalisation is on.', undoable: true, undoNote: 'You can undo this: the memory is deleted.' }; },
    run: (ctx, i) => { const m = memory.add(ctx.user.id, { text: i.text, kind: i.kind, source: 'NOVA run ' + ctx.runId + ' (you approved it)', confirmSensitive: i.confirmSensitive === true }); return { id: m.id, text: m.text }; },
    verify: (ctx, i, o) => { const m = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active'").get(o.id, ctx.user.id); return m ? { ok: true, evidence: 'Read back from the Memory Vault: memory #' + m.id + ' is saved.' } : { ok: false, evidence: 'The memory could not be found after saving.' }; },
    undo: (ctx, o) => { db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(o.id, ctx.user.id); return 'Memory #' + o.id + ' deleted.'; },
    summarize: o => 'Saved the memory "' + o.text + '".' });

  register({ name: 'memory.delete', risk: 'destructive', description: 'Delete one saved memory.', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
    preview: (ctx, i) => { const m = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active'").get(i.id, ctx.user.id); return { action: 'Delete a memory', target: 'Memory Vault', changes: [m ? 'Delete memory #' + m.id + ': "' + m.text + '"' : 'Memory #' + i.id + ' (not found)'], consequences: 'NOVA forgets it permanently.', undoable: false, undoNote: 'This cannot be undone. You would have to save the memory again.' }; },
    run: (ctx, i) => { const m = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active'").get(i.id, ctx.user.id); if (!m) throw new Error('Memory #' + i.id + ' was not found.'); db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(m.id, ctx.user.id); return { id: m.id, text: m.text }; },
    verify: (ctx, i, o) => !db.prepare('SELECT 1 FROM memories WHERE id = ? AND user_id = ?').get(o.id, ctx.user.id) ? { ok: true, evidence: 'Read back from the Memory Vault: memory #' + o.id + ' is gone.' } : { ok: false, evidence: 'The memory still exists.' },
    summarize: o => 'Deleted the memory "' + o.text + '".' });

  if (pl) {
    const { LABEL, TERMINAL } = require('../proofloop/machine');
    const own = (u, id) => db.prepare('SELECT * FROM commitments WHERE id = ? AND user_id = ?').get(id, u);
    const mine = (u, id) => { const c = own(u, id); if (!c) throw new Error('Commitment #' + id + ' was not found.'); return c; };

    register({ name: 'commitments.create', risk: 'write', description: 'Track a commitment: something the owner owes someone, or something someone owes the owner.', schema: { type: 'object', required: ['title', 'direction'], properties: { title: { type: 'string', minLength: 3, maxLength: 200 }, direction: { type: 'string', enum: ['i_owe', 'owed_to_me'] }, counterparty: { type: 'string', maxLength: 100 }, deadline: { type: 'string', format: 'date' } } },
      preview: (ctx, i) => ({ action: i.direction === 'owed_to_me' ? 'Track something owed to you' : 'Track something you owe', target: 'ProofLoop (server database)', changes: ['New commitment: "' + i.title + '"' + (i.counterparty ? ' with ' + i.counterparty : '') + (i.deadline ? ', due ' + i.deadline : ', no deadline')],
        consequences: 'It appears in ProofLoop Mission Control and stays open until it is verified. Nothing is sent to anyone.', undoable: true, undoNote: 'You can undo this: the commitment is cancelled.' }),
      run: (ctx, i) => { const id = pl.create(ctx.user.id, { title: i.title.trim(), direction: i.direction, counterparty: i.counterparty, deadline: i.deadline, sourceType: 'agent', sourceRef: 'NOVA run #' + ctx.runId, runId: ctx.runId });
        pl.transition(ctx.user.id, id, 'request_understood', { note: 'Understood from your request.', actor: 'nova' });
        if (i.direction === 'owed_to_me') pl.transition(ctx.user.id, id, 'awaiting_confirmation', { note: 'Waiting for ' + (i.counterparty || 'them') + '. NOVA cannot see their side: confirm when it arrives.', actor: 'nova' });
        return { id, title: i.title.trim(), direction: i.direction, status: pl.row(ctx.user.id, id).status }; },
      verify: (ctx, i, o) => { const c = own(ctx.user.id, o.id); return c ? { ok: true, evidence: 'Read back from ProofLoop: commitment #' + c.id + ' exists and is ' + LABEL[c.status] + '.' } : { ok: false, evidence: 'The commitment could not be found after it was created.' }; },
      undo: (ctx, o) => { try { pl.transition(ctx.user.id, o.id, 'cancelled', { note: 'You undid the creation.', actor: 'you' }); } catch (e) { /* already closed */ } return 'Commitment #' + o.id + ' cancelled.'; },
      summarize: o => 'Now tracking "' + o.title + '" (' + (o.direction === 'owed_to_me' ? 'owed to you' : 'you owe it') + ').' });

    register({ name: 'commitments.list', risk: 'read', description: 'List the owner\'s ProofLoop commitments.', schema: { type: 'object', properties: { filter: { type: 'string', enum: ['open', 'overdue', 'i_owe', 'owed_to_me', 'all'] } } },
      preview: () => ({ action: 'List your commitments', target: 'ProofLoop', changes: [], consequences: 'Nothing changes.', undoable: true }),
      run: (ctx, i) => { const f = i.filter || 'open', rows = db.prepare('SELECT * FROM commitments WHERE user_id = ? ORDER BY (deadline IS NULL), deadline, id LIMIT 100').all(ctx.user.id)
          .filter(c => f === 'all' || (f === 'overdue' ? pl.isOverdue(c) : f === 'i_owe' || f === 'owed_to_me' ? c.direction === f && !TERMINAL.includes(c.status) : !TERMINAL.includes(c.status)));
        return { commitments: rows.slice(0, 20).map(c => ({ id: c.id, title: c.title, direction: c.direction, counterparty: c.counterparty, deadline: c.deadline, status: c.status, overdue: pl.isOverdue(c) })) }; },
      summarize: o => o.commitments.length ? o.commitments.length + (o.commitments.length === 1 ? ' commitment: ' : ' commitments: ') + o.commitments.map(c => '#' + c.id + ' ' + c.title + ' (' + (c.direction === 'owed_to_me' ? 'owed to you' : 'you owe') + (c.counterparty ? ', ' + c.counterparty : '') + ', ' + LABEL[c.status] + (c.deadline ? ', due ' + c.deadline : '') + (c.overdue ? ', OVERDUE' : '') + ')').join('; ') + '.' : 'No matching commitments.' });

    register({ name: 'commitments.confirm', risk: 'write', description: 'The owner confirms a submitted commitment is really done (recorded as self-reported evidence, not independent proof).', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 }, note: { type: 'string', maxLength: 300 } } },
      preview: (ctx, i) => { const c = own(ctx.user.id, i.id); return { action: 'Confirm a commitment is done', target: 'ProofLoop', changes: [c ? 'Commitment #' + c.id + ' "' + c.title + '": ' + LABEL[c.status] + ' → Verified → Completed' + (c.task_id ? ' (and task #' + c.task_id + ' marked done)' : '') : 'Commitment #' + i.id + ' (not found)'], consequences: 'Your confirmation is recorded as evidence. It is marked self-reported: NOVA did not independently check the real-world result.', undoable: false, undoNote: 'This cannot be undone: a completed commitment is finished.' }; },
      run: (ctx, i) => { const c = mine(ctx.user.id, i.id);
        if (!['submitted', 'awaiting_confirmation'].includes(c.status)) throw new Error('Commitment #' + c.id + ' is ' + LABEL[c.status] + '. Only a Submitted or Awaiting Confirmation commitment can be confirmed.');
        pl.addEvidence(ctx.user.id, c.id, { kind: 'verified', description: 'You confirmed it is done' + (i.note ? ': ' + i.note : '') + ' (self-reported: NOVA did not independently check it).', refType: 'self' });
        pl.transition(ctx.user.id, c.id, 'verified', { note: 'You confirmed it.', actor: 'you' }); pl.transition(ctx.user.id, c.id, 'completed', { note: 'Verified, so closed.', actor: 'nova' });
        if (c.task_id) db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND user_id = ? AND status = 'open' AND deleted_at IS NULL").run(ctx.now(), c.task_id, ctx.user.id);
        return { id: c.id, title: c.title }; },
      verify: (ctx, i, o) => { const c = own(ctx.user.id, o.id); return c && c.status === 'completed' ? { ok: true, evidence: 'Read back from ProofLoop: commitment #' + c.id + ' is Completed (verified by your confirmation, not independently).' } : { ok: false, evidence: 'The commitment is not completed after the update.' }; },
      summarize: o => 'Marked "' + o.title + '" as done, on your confirmation.' });
  }

  return {
    register, get: n => tools.get(n), has: n => tools.has(n), list: () => [...tools.values()],
    // JSON Schema list for a model's `tools` parameter (names use "_" because API tool names cannot contain ".").
    forModel: () => [...tools.values()].map(t => ({ name: t.name.replace('.', '_'), description: t.description + ' (risk: ' + t.risk + (t.risk === 'read' ? '' : '; the owner must approve before it runs') + ')', input_schema: Object.assign({}, t.schema, { additionalProperties: false }) })),
    fromModelName: n => { const i = String(n).indexOf('_'); return i < 0 ? n : n.slice(0, i) + '.' + n.slice(i + 1); }
  };
}
module.exports = { createRegistry, RISKS, date };
