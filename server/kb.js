// Knowledge Base: documents you add (pasted text or .txt / .md files) are split into passages and indexed with SQLite full-text search
// (stemming, ranked). Answers are the best matching passages with their source: nothing is generated, so nothing can be invented.
// Document text is untrusted: it is shown and matched, never obeyed. Everything is per user.
'use strict';
const { HttpError, str } = require('./http');
const { audit } = require('./security');
const DEMO = [
  { title: 'Interview preparation checklist (demo)', text: '# Before the interview\nResearch the company: read its website, recent news and the job description twice. Prepare two stories about the data project using problem, action, result.\n\n# The day before\nCheck the route to the office and plan to arrive 15 minutes early. Print two copies of your CV and bring a notebook.\n\n# Questions to ask\nAsk about the team, how success is measured in the first three months, and what training is offered to new graduates.' },
  { title: 'UAE visa and residency notes (demo)', text: '# Visa renewal\nA residence visa renewal needs the passport, the old Emirates ID, two passport photos and a medical test result. Start the renewal 30 days before expiry to avoid fines.\n\n# Fines\nOverstaying a residence visa costs AED 25 per day after the grace period. Keep the payment receipt.\n\n# Useful offices\nTyping centres can submit applications for you. Always keep copies of every submitted document.' },
  { title: 'Statistics study group notes (demo)', text: '# Hypothesis testing\nA p-value below 0.05 means the result would be unlikely if the null hypothesis were true. It does not give the probability that the hypothesis is true.\n\n# Sample size\nSmall samples give wide confidence intervals. Collect more data before drawing strong conclusions.\n\n# Study plan\nMeet on Wednesday evenings. Practise one past paper per week and review the mistakes together.' }
];
const STOP = new Set('a an the and or of to in on for with is are was were be been what which who whom how do does did my me i you it this that these those at by from as about say says tell find search show give any'.split(' '));
const words = q => String(q || '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));

// Splits text into passages of roughly 100-700 characters, at headings and paragraph breaks, remembering the heading each one sits under.
function split(text) {
  const out = []; let heading = '', buf = '';
  const flush = () => { const t = buf.trim(); if (t) out.push({ heading, text: t }); buf = ''; };
  for (const para of String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = para.split('\n');
    while (lines.length && /^#{1,4}\s+\S/.test(lines[0])) { flush(); heading = lines.shift().replace(/^#+\s+/, '').trim().slice(0, 120); }
    const body = lines.join('\n').trim(); if (!body) continue;
    if (buf && (buf.length + body.length > 700)) flush();
    if (body.length > 700) { for (const s of body.split(/(?<=[.!?])\s+/)) { if (buf.length + s.length > 700) flush(); buf += (buf ? ' ' : '') + s; } flush(); }
    else buf += (buf ? '\n\n' : '') + body;
  }
  flush();
  return out;
}

function createKb(cfg, db) {
  const now = cfg.now;
  function add(userId, o) {
    const text = String(o.text || '').replace(/\u0000/g, '').trim();
    if (!text) throw new HttpError(400, 'The document is empty.', 'invalid');
    if (text.length > 200000) throw new HttpError(413, 'That document is too large (limit 200,000 characters). Split it into parts.', 'too_large');
    const parts = split(text), t = now();
    db.exec('BEGIN');
    try {
      const r = db.prepare('INSERT INTO documents (user_id, title, kind, source, chars, chunks, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, o.title, o.kind || 'note', o.source || null, text.length, parts.length, o.isDemo ? 1 : 0, t, t);
      const id = Number(r.lastInsertRowid), ins = db.prepare('INSERT INTO chunks (document_id, user_id, seq, heading, text) VALUES (?, ?, ?, ?, ?)'), fts = db.prepare('INSERT INTO chunks_fts (rowid, text, heading) VALUES (?, ?, ?)');
      parts.forEach((p, i) => { const c = ins.run(id, userId, i, p.heading, p.text); fts.run(Number(c.lastInsertRowid), p.text, p.heading); });
      db.exec('COMMIT'); return id;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function remove(userId, id) {
    const d = db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(id, userId);
    if (!d) throw new HttpError(404, 'Document not found.', 'not_found');
    for (const c of db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(id)) db.prepare('DELETE FROM chunks_fts WHERE rowid = ?').run(c.id);
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id); db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
  // Best passages first. Every result names its document, heading and position so the answer can be checked at the source.
  function search(userId, query, limit) {
    const w = words(query); if (!w.length) return [];
    const match = w.map(x => '"' + x.replace(/"/g, '') + '"').join(' OR ');
    let rows;
    try {
      rows = db.prepare("SELECT c.id, c.document_id, c.seq, c.heading, c.text, d.title, d.is_demo, bm25(chunks_fts, 1.0, 2.0) AS score, snippet(chunks_fts, 0, '[[', ']]', '…', 24) AS snip FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.id = c.document_id WHERE chunks_fts MATCH ? AND c.user_id = ? ORDER BY score LIMIT ?").all(match, userId, (limit || 5) * 3);
    } catch (e) { return []; }
    const need = Math.max(1, Math.ceil(w.length / 2)), seen = new Set();
    return rows.map(r => { const low = (r.text + ' ' + (r.heading || '')).toLowerCase(), hit = w.filter(x => low.includes(x.replace(/(ing|ed|es|s)$/, ''))); return Object.assign(r, { hits: hit.length }); })
      .filter(r => r.hits >= need).filter(r => !seen.has(r.id) && seen.add(r.id)).slice(0, limit || 5)
      .map((r, i) => ({ n: i + 1, documentId: r.document_id, title: r.title, heading: r.heading || null, seq: r.seq + 1, text: r.text, snippet: r.snip, matched: r.hits + ' of ' + w.length + ' search words', isDemo: !!r.is_demo }));
  }
  function ask(userId, q) {
    const hits = search(userId, q, 3);
    if (!hits.length) return { found: false, answer: 'I found nothing about that in your documents. NOVA only answers from what you have added, so it does not guess. Add a note or document on the Knowledge Base page.', sources: [] };
    const first = hits[0], lead = first.text.length > 420 ? first.text.slice(0, 420).replace(/\s+\S*$/, '') + '…' : first.text;
    return { found: true, answer: 'From "' + first.title + '"' + (first.heading ? ', section "' + first.heading + '"' : '') + ': ' + lead.replace(/\s+/g, ' ') + (hits.length > 1 ? ' (Also in: ' + hits.slice(1).map(h => '"' + h.title + '"').filter((x, i, a) => a.indexOf(x) === i && x !== '"' + first.title + '"').join(', ') + '.)' : '').replace(' (Also in: .)', ''), sources: hits };
  }
  const view = d => ({ id: d.id, title: d.title, kind: d.kind, source: d.source, chars: d.chars, chunks: d.chunks, isDemo: !!d.is_demo, createdAt: d.created_at });

  function register(router) {
    router.get('/api/kb', ctx => ({ status: 200, body: { documents: db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(ctx.auth.user.id).map(view), limits: { maxChars: 200000 } } }));
    router.post('/api/kb', ctx => {
      const title = str(ctx.body.title, 'title', { max: 140 }), text = str(ctx.body.text, 'text', { max: 200000 });
      const id = add(ctx.auth.user.id, { title, text, kind: ctx.body.kind === 'file' ? 'file' : 'note', source: ctx.body.source ? String(ctx.body.source).slice(0, 200) : null });
      audit(db, now, ctx.auth.user.id, 'kb_document_added', 'document #' + id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { document: view(db.prepare('SELECT * FROM documents WHERE id = ?').get(id)) } };
    });
    router.get('/api/kb/search', ctx => { const q = ctx.url.searchParams.get('q') || ''; if (q.length > 300) throw new HttpError(400, 'Search is too long.', 'invalid'); return { status: 200, body: { query: q, results: search(ctx.auth.user.id, q, 8) } }; });
    router.post('/api/kb/ask', ctx => ({ status: 200, body: ask(ctx.auth.user.id, str(ctx.body.question, 'question', { max: 300 })) }));
    router.get('/api/kb/:id', ctx => {
      const d = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(+ctx.params.id, ctx.auth.user.id);
      if (!d) throw new HttpError(404, 'Document not found.', 'not_found');
      return { status: 200, body: { document: view(d), passages: db.prepare('SELECT seq, heading, text FROM chunks WHERE document_id = ? ORDER BY seq').all(d.id).map(c => ({ n: c.seq + 1, heading: c.heading, text: c.text })) } };
    });
    router.del('/api/kb/:id', ctx => { remove(ctx.auth.user.id, +ctx.params.id); audit(db, now, ctx.auth.user.id, 'kb_document_deleted', 'document #' + ctx.params.id, ctx.req.socket.remoteAddress); return { status: 200, body: { ok: true } }; });
    router.post('/api/kb/demo', ctx => {
      const have = new Set(db.prepare('SELECT title FROM documents WHERE user_id = ? AND is_demo = 1').all(ctx.auth.user.id).map(r => r.title));
      let n = 0; for (const d of DEMO) if (!have.has(d.title)) { add(ctx.auth.user.id, { title: d.title, text: d.text, isDemo: true, source: 'demo' }); n++; }
      return { status: 200, body: { added: n } };
    });
    router.post('/api/kb/demo/remove', ctx => { let n = 0; for (const d of db.prepare('SELECT id FROM documents WHERE user_id = ? AND is_demo = 1').all(ctx.auth.user.id)) { remove(ctx.auth.user.id, d.id); n++; } return { status: 200, body: { removed: n } }; });
  }
  return { add, remove, search, ask, register, split, words, DEMO };
}
module.exports = { createKb, split, words };
