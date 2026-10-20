/* The requests NOVA's server handles with built-in actions (create / list / complete / delete tasks, notes, memory search and forget).
   One list, used by the server planner (server/agent/planner.js) and by the browser (voice goes to NOVA when a phrase matches), so they can never disagree. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.NovaIntents = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var P = {
    create: [/^(?:add|create|make|new)\s+(?:a\s+|an\s+)?(?:task|to-?do|reminder)(?:\s+(?:to|for|called|named)|\s*:)?\s+(.{1,})$/i, /^remind me to\s+(.+)$/i],
    list: /^(?:what(?:'s| are| is)?\s+(?:on\s+)?my\s+(?:open\s+|done\s+)?(?:tasks|to-?do(?:s| list)?)|(?:list|show)(?:\s+me)?(?:\s+my)?\s+(open\s+|done\s+|all\s+)?tasks?)\??$/i,
    complete: /^(?:mark|complete|finish)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+as\s+done|\s+done)?$/i,
    del: /^(?:delete|remove)\s+(?:the\s+)?task\s+(.+)$/i,
    note: [/^(?:add|save|create)\s+(?:a\s+)?note(?:\s+(?:that|to|saying)|\s*:)?\s+(.+)$/i, /^note\s+that\s+(.+)$/i],
    notes: /^(?:list|show)(?:\s+me)?(?:\s+my)?\s+notes$/i,
    search: /^(?:search|look\s+up|find)\s+(?:my\s+)?memor(?:y|ies)\s+(?:for|about)\s+(.+)$/i,
    forget: /^forget(?:\s+that)?[:,]?\s+(.{3,})$/i,
    // ProofLoop: things owed in either direction, listing them, and confirming that something is done.
    oweMe: /^(.+?)\s+(?:owes me|promised me|will send me|is going to send me|has to send me)\s+(.+?)(?:\s+(?:by|before|on)\s+(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2}))?$/i,
    iPromised: /^i\s+promised\s+(.+?)\s+to\s+(.+?)(?:\s+(?:by|before|on)\s+(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2}))?$/i,
    commitList: /^(?:what\s+do\s+i\s+owe|what(?:'s| is)\s+owed\s+to\s+me|who\s+owes\s+me|what(?:'s| is)\s+overdue|(?:show|list)(?:\s+me)?(?:\s+my)?\s+(?:open\s+|overdue\s+)?commitments)\??$/i,
    briefing: /^(?:(?:give me|read me|show me|read|show|what(?:'s| is))\s+)?(?:my\s+|the\s+|today's\s+)?(?:daily\s+|morning\s+)?briefing\??$|^brief me$|^what(?:'s| is)\s+(?:on\s+)?my\s+day(?:\s+look\s+like)?\??$|^how\s+does\s+my\s+day\s+look\??$/i,
    email: /^(?:(?:check|read|show|list|summari[sz]e)(?:\s+me)?\s+)?(?:my\s+)?(?:important\s+|new\s+|urgent\s+|unread\s+)?(?:e-?mails?|inbox|mail)\??$|^(?:(?:do\s+i\s+have\s+)?any|are\s+there\s+any)\s+(?:important\s+|new\s+|urgent\s+)?e-?mails?\??$|^(?:which|what)\s+e-?mails?\s+(?:need|needs)\s+(?:a\s+)?(?:reply|replies|answer)\??$/i,
    kb: [/^(?:search|look\s+up|find|check)\s+(?:in\s+)?(?:my\s+)?(?:documents?|docs|files|knowledge\s+base|kb)\s+(?:for|about)\s+(.{2,})$/i, /^what\s+(?:do|does)\s+my\s+(?:notes|documents?|docs|files|knowledge\s+base)\s+say\s+about\s+(.{2,}?)\??$/i, /^(?:ask\s+my\s+(?:documents?|docs|knowledge\s+base)|according\s+to\s+my\s+(?:notes|documents?|docs))[,:]?\s+(.{2,}?)\??$/i],
    confirm: /^(?:i(?:'ve| have)?\s+(?:sent|finished|delivered|submitted|handed in|completed)|confirm(?:\s+that)?(?:\s+commitment)?)\s+(.+)$/i
  };
  function clean(message) { return String(message).trim().replace(/^(?:hey |ok |okay |hi )?(?:nova|jarvis)[, ]+/i, '').replace(/^please\s+/i, ''); }
  // True when the phrase is one NOVA's built-in actions understand ("mark ... done" must not swallow notes or memories).
  function matches(message) {
    var m = clean(message), c;
    if (P.create.concat(P.note).some(function (r) { return r.test(m); })) return true;
    if (P.list.test(m) || P.notes.test(m) || P.del.test(m) || P.search.test(m) || P.forget.test(m)) return true;
    var o = P.oweMe.exec(m);
    if (P.commitList.test(m) || (o && !/^(?:i|you|we)$/i.test(o[1].trim())) || P.iPromised.test(m)) return true;
    if (P.confirm.test(m) || P.briefing.test(m) || P.email.test(m) || P.kb.some(function (r) { return r.test(m); })) return true;
    c = P.complete.exec(m); return !!c && !/^(?:note|memory)/i.test(c[1]);
  }
  return { P: P, clean: clean, matches: matches };
});
