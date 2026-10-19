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
    forget: /^forget(?:\s+that)?[:,]?\s+(.{3,})$/i
  };
  function clean(message) { return String(message).trim().replace(/^(?:hey |ok |okay |hi )?(?:nova|jarvis)[, ]+/i, '').replace(/^please\s+/i, ''); }
  // True when the phrase is one NOVA's built-in actions understand ("mark ... done" must not swallow notes or memories).
  function matches(message) {
    var m = clean(message), c;
    if (P.create.concat(P.note).some(function (r) { return r.test(m); })) return true;
    if (P.list.test(m) || P.notes.test(m) || P.del.test(m) || P.search.test(m) || P.forget.test(m)) return true;
    c = P.complete.exec(m); return !!c && !/^(?:note|memory)/i.test(c[1]);
  }
  return { P: P, clean: clean, matches: matches };
});
