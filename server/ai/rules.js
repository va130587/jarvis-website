// Free, deterministic request handling. These rules answer without any AI model, cost nothing and cannot hallucinate.
// Each rule returns { operation, reply, steps, proposal? } or null when it does not apply.
'use strict';
const { classify } = require('../memory');

const KIND_HINTS = [[/\b(goal|aim|want to become|dream)\b/i, 'goal'], [/\b(prefer|like it when|please always|always|never|style|tone)\b/i, 'preference'], [/\b(project|building|working on)\b/i, 'project'],
  [/\b(contact|email is|colleague|manager|supervisor|friend)\b/i, 'contact'], [/\b(priority|most important|first)\b/i, 'priority'], [/\b(every (?:day|week|month|monday|tuesday|wednesday|thursday|friday)|daily|weekly|monthly)\b/i, 'recurring']];
const guessKind = t => (KIND_HINTS.find(([rx]) => rx.test(t)) || [0, 'fact'])[1];

function dubaiNow(ms) {
  const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'Asia/Dubai' }, o)).format(new Date(ms));
  return { time: f({ hour: '2-digit', minute: '2-digit', hour12: false }), date: f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
}

// ctx: { user, memories (relevant), allMemories(fn), now }
const RULES = [
  { id: 'identify_user', rx: /^(?:nova[, ]*)?(?:who am i|what(?:'s| is) my name|do you know (?:me|who i am)|tell me about me)\??$/i,
    run(ctx) {
      const u = ctx.user, mem = ctx.allActive();
      let s = 'You\'re ' + u.displayName + ', the owner of this authenticated NOVA account (' + u.email + ').';
      if (u.personalization && mem.length) s += ' Based on the information you\'ve chosen to save, I know ' + mem.length + (mem.length === 1 ? ' thing' : ' things') + ' about you: ' + mem.slice(0, 5).map(m => m.text).join('; ') + (mem.length > 5 ? '; and ' + (mem.length - 5) + ' more in your Memory Vault' : '') + '.';
      else if (!u.personalization) s += ' Personalisation is switched off, so I am not using any saved memories.';
      else s += ' You haven\'t saved any memories yet. Tell me "remember that…" or add some in the Memory Vault and I can help you manage your projects, important emails, deadlines and everyday tasks.';
      return { operation: 'identify_user', reply: s, steps: ['Read your identity from the signed-in account (not from what you typed).', u.personalization ? 'Listed your approved memories (' + mem.length + ').' : 'Personalisation is off: no memories used.'] };
    } },
  { id: 'list_memory', rx: /^(?:nova[, ]*)?(?:what do you (?:remember|know) about me|show (?:me )?my memor(?:y|ies)|list (?:my )?memor(?:y|ies)|what have i told you)\??$/i,
    run(ctx) {
      const mem = ctx.allActive();
      if (!ctx.user.personalization) return { operation: 'list_memory', reply: 'Personalisation is off, so I am not using saved memories. You can turn it on in Security and Settings.', steps: ['Personalisation is off.'] };
      return { operation: 'list_memory', reply: mem.length ? 'I remember ' + mem.length + (mem.length === 1 ? ' thing' : ' things') + ': ' + mem.map(m => m.text + ' (saved ' + new Date(m.createdAt).toISOString().slice(0, 10) + ', source: ' + m.source + ')').join('; ') + '.' : 'I have no saved memories yet.', steps: ['Listed your approved memories (' + mem.length + ').'] };
    } },
  { id: 'propose_memory', rx: /^(?:nova[, ]*)?(?:please )?remember(?: that)?[:,]?\s+(.{3,})$/i,
    run(ctx, m) {
      const text = m[1].trim().replace(/[.!]+$/, '').slice(0, 500), c = classify(text);
      if (c.blocked) return { operation: 'propose_memory', reply: 'I will not store ' + c.blocked + '. Please keep it in a password manager.', steps: ['Checked the text: it contains ' + c.blocked + ', so nothing was saved.'], status: 'refused' };
      return { operation: 'propose_memory', reply: 'I can remember: "' + text + '". It is not saved yet. Approve it below' + (c.sensitive ? ' (it looks sensitive, so I will ask you to confirm)' : '') + '.',
        steps: ['Prepared a memory for you to approve. Nothing is saved until you approve it.'], proposal: { text, kind: guessKind(text), sensitive: c.sensitive }, status: 'awaiting_approval' };
    } },
  { id: 'time', rx: /^(?:nova[, ]*)?(?:what(?:'s| is) the (?:time|date)|what time is it|what(?:'s| is) today(?:'s date)?|what day is it)\??$/i,
    run(ctx) { const d = dubaiNow(ctx.now); return { operation: 'time', reply: 'It is ' + d.time + ' on ' + d.date + ' in Dubai.', steps: ['Read the server clock in the Asia/Dubai time zone.'] }; } },
  { id: 'help', rx: /^(?:nova[, ]*)?(?:help|what can you do|what do you do)\??$/i,
    run() { return { operation: 'help', reply: 'Right now I can: tell you who you are, remember things you approve ("remember that…"), list your memories, tell you the time, and (when an AI model is configured) answer other questions. Email, ProofLoop, automations and voice commands for them are still being built and are marked Upcoming.', steps: ['Listed what is working today.'] }; } },
  { id: 'greeting', rx: /^(?:hi|hello|hey|salam|marhaba|good (?:morning|afternoon|evening))(?:[, ]+nova)?[.!]?$/i,
    run(ctx) { return { operation: 'greeting', reply: 'Hello ' + ctx.user.displayName + '. How can I help?', steps: ['Greeted you by the name on your account.'] }; } }
];

function match(message) {
  const text = message.trim();
  for (const r of RULES) { const m = r.rx.exec(text); if (m) return { id: r.id, run: ctx => r.run(ctx, m) }; }
  return null;
}
module.exports = { match, guessKind, dubaiNow };
