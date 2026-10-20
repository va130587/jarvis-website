/* NOVA Life Tracker (server mode): one capture bar that understands everyday sentences ("remind me at 6pm to call mum",
   "spent 45 on lunch", "check in reading"), timed reminders delivered by the server, habits with streaks and a 13-week
   heatmap, and money in AED with a monthly budget. Changes made from the capture bar show a preview and wait for Approve. */
(function () {
  'use strict';
  var J = window.J, N = window.NOVA; if (!J || !N) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var api = function (m, p, b) { return N.api(m, p, b); };
  var fail = function (e) { J.toast(e && e.message ? e.message : 'Something went wrong.'); };
  var L = N.life = { capture: null };
  var CAT_LABEL = { food: 'Food', transport: 'Transport', groceries: 'Groceries', bills: 'Bills', shopping: 'Shopping', health: 'Health', learning: 'Learning', fun: 'Fun', other: 'Other' };
  function reload() { return N.h.load('life', '/api/life').then(function () { J.render(false); }); }

  /* ---- capture bar: the same NOVA chat brain, with its approval card inline ---- */
  function captureHTML() {
    var c = L.capture;
    return '<article class="panel capture"><form id="lifeCap" class="chat-form" autocomplete="off"><label for="lifeQ" class="sr-only">Tell NOVA</label><input id="lifeQ" type="text" maxlength="300" placeholder="Try: remind me at 6pm to call mum · spent 45 on lunch · check in reading"><button type="submit" class="btn primary">Go</button></form>' +
      (c ? '<div class="cap-out" aria-live="polite">' + (c.preview ? '<p class="tag gold">Review before NOVA acts</p><p class="cap-what"><b>' + esc(c.preview.action) + ':</b> ' + esc((c.preview.changes || [])[0] || '') + '</p><p class="small-text muted">' + esc(c.preview.consequences) + ' ' + (c.preview.undoable ? 'You can undo it.' : '') + '</p>' +
        '<div class="btn-row"><button type="button" class="btn small primary" data-act="lifeApprove" data-id="' + c.approvalId + '">Approve</button><button type="button" class="btn small" data-act="lifeReject" data-id="' + c.approvalId + '">Reject</button></div>' : '<p class="cap-reply">' + esc(c.reply) + '</p>') + '</div>' :
        '<p class="small-text muted">Times are Dubai time. A clock time ("at 6pm", "in 20 minutes") makes a timed reminder; a date only ("tomorrow") makes a task.</p>') + '</article>';
  }
  function capture(text) {
    text = String(text || '').trim(); if (!text) return;
    api('POST', '/api/chat', { message: text }).then(function (r) {
      var a = r.run && r.run.pendingApproval;
      L.capture = a ? { approvalId: a.id, preview: a.preview } : { reply: r.reply };
      J.render(false); if (!a) reload();
    }).catch(fail);
  }

  /* ---- reminders ---- */
  function remindersHTML(d) {
    var pend = d.reminders.filter(function (r) { return r.status === 'pending'; }), sent = d.reminders.filter(function (r) { return r.status === 'sent'; });
    return '<article class="panel life-rem"><div class="panel-head"><h2 class="label">Reminders <span class="n">' + pend.length + '</span></h2></div>' +
      '<form id="remForm" class="rem-form" autocomplete="off"><div class="field"><label for="remText">Remind me to</label><input id="remText" type="text" maxlength="200" placeholder="call mum"></div><div class="field"><label for="remWhen">When</label><input id="remWhen" type="text" maxlength="60" placeholder="6pm · in 20 min"></div><button type="submit" class="btn primary small">Set reminder</button></form>' +
      (pend.length ? '<ul class="rem-list">' + pend.map(function (r) { return '<li><span class="rem-time mono">' + esc(r.dueLabel.replace(' (Dubai)', '')) + '</span><span class="rem-text">' + esc(r.text) + (r.repeat !== 'none' ? ' ' + J.tag(r.repeat === 'daily' ? 'every day' : 'weekdays', 'dim') : '') + '</span><button type="button" class="btn small ghost" data-act="remCancel" data-id="' + r.id + '" aria-label="Cancel reminder: ' + esc(r.text) + '">Cancel</button></li>'; }).join('') + '</ul>' : '<p class="empty">No reminders set. NOVA delivers them even when this page is closed (as long as the NOVA server runs), to the bell, a pop-up and your phone if ntfy is set up.</p>') +
      (sent.length ? '<details class="small-text"><summary>Recently delivered (' + sent.length + ')</summary><ul class="rem-list done">' + sent.map(function (r) { return '<li><span class="rem-time mono">' + esc(r.dueLabel.replace(' (Dubai)', '')) + '</span><span class="rem-text">' + esc(r.text) + '</span><button type="button" class="btn small ghost" data-act="remSnooze" data-id="' + r.id + '">Again in 10 min</button></li>'; }).join('') + '</ul></details>' : '') + '</article>';
  }

  /* ---- habits ---- */
  function heat(h) {
    var weeks = []; for (var i = 0; i < h.grid.length; i += 7) weeks.push(h.grid.slice(i, i + 7));
    return '<div class="heat" role="img" aria-label="' + esc(h.name) + ': ' + h.total + ' check-ins, ' + h.rate30 + '% of scheduled days in the last 30 days">' + weeks.map(function (w) {
      return '<span class="hw">' + w.map(function (c) { return '<i class="' + (c.done ? 'on' : c.scheduled ? '' : 'off') + '" title="' + esc(c.day + (c.done ? ': done' : '')) + '"></i>'; }).join('') + '</span>';
    }).join('') + '</div>';
  }
  function habitsHTML(d) {
    return '<article class="panel life-hab"><div class="panel-head"><h2 class="label">Habits <span class="n">' + d.habits.length + '</span></h2></div>' +
      (d.habits.length ? '<div class="hab-list">' + d.habits.map(function (h) {
        return '<section class="hab' + (h.doneToday ? ' done' : '') + '"><div class="hab-head"><button type="button" class="hab-check" data-act="habToggle" data-id="' + h.id + '" data-done="' + h.doneToday + '" aria-pressed="' + h.doneToday + '" aria-label="' + esc(h.name) + ': done today"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>' +
          '<div class="hab-name"><b>' + esc(h.name) + '</b><small>' + (h.schedule === 'weekdays' ? 'Monday to Friday' : 'Every day') + ' · ' + h.rate30 + '% in 30 days</small></div>' +
          '<div class="streak" title="Current streak"><b class="num">' + h.streak + '</b><small>day streak' + (h.best > h.streak ? ' · best ' + h.best : '') + '</small></div></div>' + heat(h) +
          '<button type="button" class="link-btn small-text" data-act="habArchive" data-id="' + h.id + '">Stop tracking</button></section>';
      }).join('') + '</div>' : '<p class="empty">No habits yet. Add one small daily thing, for example "Read 10 pages".</p>') +
      '<form id="habForm" class="rem-form" autocomplete="off"><div class="field"><label for="habName">New habit</label><input id="habName" type="text" maxlength="60" placeholder="Read 10 pages"></div><div class="field"><label for="habSched">Days</label><select id="habSched"><option value="daily">Every day</option><option value="weekdays">Monday to Friday</option></select></div><button type="submit" class="btn small">Add habit</button></form></article>';
  }

  /* ---- money ---- */
  function moneyHTML(d) {
    var m = d.money, b = m.budget, max = m.byCategory.length ? m.byCategory[0].fils : 1;
    var trend = m.prevTotal ? (m.total >= m.prevTotal ? '▲ ' : '▼ ') + Math.abs(Math.round(100 * (m.total - m.prevTotal) / m.prevTotal)) + '% vs last month (' + m.prevLabel + ')' : 'nothing recorded last month';
    return '<article class="panel life-money"><div class="panel-head"><h2 class="label">Money · ' + esc(m.month) + '</h2></div>' +
      '<p class="money-total"><b class="num">' + esc(m.totalLabel) + '</b><small>' + esc(trend) + '</small></p>' +
      (b ? '<div class="budget" role="img" aria-label="Budget: ' + b.usedPct + '% used, ' + esc(b.leftLabel) + ' left; ' + b.pacePct + '% of the month has passed"><div class="bar"><i class="' + (b.usedPct >= 100 ? 'red' : b.usedPct > b.pacePct ? 'gold' : 'ok') + '" style="width:' + Math.min(100, b.usedPct) + '%"></i><em style="left:' + b.pacePct + '%" title="Where you would be at an even pace"></em></div>' +
        '<p class="small-text">' + b.usedPct + '% of ' + esc(b.label) + ' used · ' + esc(b.leftLabel) + ' left · ' + (b.usedPct > b.pacePct ? 'ahead of an even pace' : 'within an even pace') + '</p></div>' : '') +
      (m.byCategory.length ? '<ul class="cat-bars" aria-label="Spending by category">' + m.byCategory.map(function (c) { return '<li><span class="cb-name">' + esc(CAT_LABEL[c.category] || c.category) + '</span><span class="cb-bar"><i style="width:' + Math.max(2, Math.round(100 * c.fils / max)) + '%"></i></span><span class="cb-val mono">' + esc(c.label) + '</span></li>'; }).join('') + '</ul>' : '<p class="empty">Nothing spent yet this month. Say "spent 45 on lunch".</p>') +
      '<form id="expForm" class="exp-form" autocomplete="off"><div class="field"><label for="expAmt">Amount (AED)</label><input id="expAmt" type="text" inputmode="decimal" maxlength="12" placeholder="45"></div><div class="field"><label for="expNote">On</label><input id="expNote" type="text" maxlength="120" placeholder="lunch"></div>' +
        '<div class="field"><label for="expCat">Category</label><select id="expCat"><option value="">Automatic</option>' + d.categories.map(function (c) { return '<option value="' + c + '">' + esc(CAT_LABEL[c] || c) + '</option>'; }).join('') + '</select></div><button type="submit" class="btn small primary">Add</button></form>' +
      (m.recent.length ? '<details class="small-text"><summary>Recent (' + m.recent.length + ')</summary><ul class="exp-list">' + m.recent.map(function (e) { return '<li><span class="mono">' + esc(e.day) + '</span><span>' + esc(e.note || CAT_LABEL[e.category]) + ' <small class="muted">' + esc(CAT_LABEL[e.category] || e.category) + '</small></span><span class="mono">' + esc(e.label) + '</span><button type="button" class="btn small ghost" data-act="expDelete" data-id="' + e.id + '" aria-label="Delete ' + esc(e.label) + ' ' + esc(e.note || '') + '">Delete</button></li>'; }).join('') + '</ul></details>' : '') +
      '<div class="budget-set"><label for="budAmt" class="small-text">Monthly budget (AED)</label><input id="budAmt" type="text" inputmode="decimal" maxlength="10" value="' + (b ? (b.fils / 100) : '') + '" placeholder="3000"><button type="button" class="btn small ghost" data-act="budSave">Save budget</button></div></article>';
  }

  S.life = {
    render: function () {
      var d = N.cache.life, head = J.head('Everyday', 'Life Tracker', 'Reminders at a time, habits with streaks, and your spending in AED. Just say it: NOVA understands everyday sentences and asks before changing anything.', '');
      if (!d) return head + J.empty('Loading…');
      return head + captureHTML() + '<div class="life-grid">' + remindersHTML(d) + habitsHTML(d) + moneyHTML(d) + '</div>';
    },
    after: function () {
      N.h.stale('life', [['life', '/api/life']]);
      var f = $('#lifeCap'); if (f) f.addEventListener('submit', function (e) { e.preventDefault(); capture($('#lifeQ').value); });
      var rf = $('#remForm'); if (rf) rf.addEventListener('submit', function (e) {
        e.preventDefault(); var t = $('#remText').value.trim(), w = $('#remWhen').value.trim();
        if (!t || !w) { J.toast('Say what and when, for example: call mum, at 6pm.'); return; }
        api('POST', '/api/reminders', { text: t, when: w }).then(function (r) { J.toast('Reminder set for ' + r.reminder.dueLabel + '.'); return reload(); }).catch(fail);
      });
      var hf = $('#habForm'); if (hf) hf.addEventListener('submit', function (e) { e.preventDefault(); var n = $('#habName').value.trim(); if (!n) return; api('POST', '/api/habits', { name: n, schedule: $('#habSched').value }).then(function () { J.toast('Tracking "' + n + '". Check it in each day to build a streak.'); return reload(); }).catch(fail); });
      var ef = $('#expForm'); if (ef) ef.addEventListener('submit', function (e) {
        e.preventDefault(); var a = $('#expAmt').value.trim(), n = $('#expNote').value.trim(), c = $('#expCat').value;
        if (!a) { J.toast('Enter an amount.'); return; }
        api('POST', '/api/expenses', Object.assign({ amount: a, note: n || undefined }, c ? { category: c } : {})).then(function (r) { J.toast('Recorded ' + r.expense.label + ' (' + (CAT_LABEL[r.expense.category] || r.expense.category) + ').'); return reload(); }).catch(fail);
      });
    }
  };

  Object.assign(J.actions, {
    lifeApprove: function (id) { api('POST', '/api/approvals/' + id + '/approve', {}).then(function (run) { L.capture = { reply: run.result || 'Done.' }; return reload(); }).catch(function (e) { L.capture = null; fail(e); J.render(false); }); },
    lifeReject: function (id) { api('POST', '/api/approvals/' + id + '/reject', {}).then(function () { L.capture = { reply: 'Okay, nothing was changed.' }; J.render(false); }).catch(fail); },
    remCancel: function (id) { api('POST', '/api/reminders/' + id + '/cancel', {}).then(function () { J.toast('Reminder cancelled.'); return reload(); }).catch(fail); },
    remSnooze: function (id) { api('POST', '/api/reminders/' + id + '/snooze', { minutes: 10 }).then(function (r) { J.toast('I will remind you again at ' + r.reminder.dueLabel + '.'); return reload(); }).catch(fail); },
    habToggle: function (id, el) { var done = el.getAttribute('data-done') === 'true'; api('POST', '/api/habits/' + id + '/check', { done: !done }).then(function (r) { if (!done) J.toast(r.habit.name + ': ' + r.habit.streak + ' day streak' + (r.habit.streak >= r.habit.best && r.habit.streak > 1 ? ', your best yet!' : '.')); return reload(); }).catch(fail); },
    habArchive: function (id) { J.confirm('Its history is kept, but it is no longer shown or counted.', 'Stop tracking', 'Stop tracking this habit?').then(function (ok) { if (ok) api('POST', '/api/habits/' + id + '/archive', {}).then(reload).catch(fail); }); },
    expDelete: function (id) { api('DELETE', '/api/expenses/' + id).then(function () { J.toast('Expense deleted.'); return reload(); }).catch(fail); },
    budSave: function () { var v = $('#budAmt').value.trim(); api('POST', '/api/budget', { amount: v === '' ? null : v }).then(function (r) { J.toast(r.budget ? 'Budget saved: ' + r.budget.label + ' a month.' : 'Budget removed.'); return reload(); }).catch(fail); }
  });
})();
