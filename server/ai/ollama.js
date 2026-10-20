// Free local model through Ollama (https://ollama.com). Runs on your own computer; nothing leaves it. Needs `ollama serve` and a pulled model.
// Small models are less reliable than a big cloud model, so NOVA never trusts the answer: every tool call is validated, risky ones wait for you,
// and when the model is unsure it is told to ask a short question (the ask.clarify tool) instead of guessing.
'use strict';
const { toWire, untrusted } = require('./claude');

const FEWSHOT = [
  'Examples of good behaviour (follow the style, not the exact words):',
  'Owner: "I need to remember to send the proposal to the client before Friday" -> call tasks_create {"title":"Send the proposal to the client","due":"<the Friday date>"}.',
  'Owner: "what do I have on" -> call tasks_list {"status":"open"}.',
  'Owner: "ad a tsk to buy mlk" -> call tasks_create {"title":"Buy milk"} (fix obvious typos).',
  'Owner: "do the thing" or "delete it" -> call ask_clarify {"question":"Which task do you mean?"} (never guess).',
  'Owner: "tell me a joke" -> answer in plain text, no tool.'
].join('\n');

class OllamaError extends Error { constructor(message, userMessage) { super(message); this.userMessage = userMessage; } }

function createOllama(cfg, deps) {
  deps = deps || {};
  const doFetch = deps.fetch || fetch, base = cfg.ai.ollamaUrl.replace(/\/$/, ''), model = cfg.ai.ollamaModel, timeoutMs = cfg.ai.ollamaTimeoutMs;
  const setupHint = 'Start Ollama (`ollama serve`) and download the model once with `ollama pull ' + model + '`. Built-in actions still work without it.';

  function toOllama(messages) {
    const out = [];
    for (const m of messages) {
      if (m.role === 'assistant_call') out.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: m.name.replace('.', '_'), arguments: m.input && typeof m.input === 'object' ? m.input : {} } }] });
      else if (m.role === 'tool_result') out.push({ role: 'tool', tool_name: undefined, content: untrusted(m.payload) });
      else out.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
    }
    return out;
  }
  async function http(path, body, signal, ms) {
    const sig = AbortSignal.any([signal, AbortSignal.timeout(ms)].filter(Boolean));
    try {
      const r = await doFetch(base + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: sig });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new OllamaError('Ollama HTTP ' + r.status + ' ' + t.slice(0, 120), r.status === 404 ? 'Ollama is running but the model "' + model + '" is not downloaded. ' + setupHint : 'The local model returned an error (HTTP ' + r.status + '). ' + setupHint); }
      return await r.json();
    } catch (e) {
      if (e instanceof OllamaError) throw e;
      if (signal && signal.aborted) throw e;                                       // cancelled by the person: not an Ollama problem
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new OllamaError('Ollama timed out after ' + ms + ' ms', 'The local model took longer than ' + Math.round(ms / 1000) + ' seconds. A smaller model (for example qwen2.5:3b) is faster. Built-in actions still work.');
      throw new OllamaError('Ollama is not reachable at ' + base, 'The local model (Ollama) is not reachable at ' + base + '. ' + setupHint);
    }
  }
  // A few models print the call as JSON text instead of using the tool-call field; accept that form too (still validated like any other call).
  function callFromText(text, tools) {
    const m = /\{[\s\S]*\}/.exec(text || ''); if (!m) return null;
    try { const o = JSON.parse(m[0]); const name = o.name || (o.function && o.function.name), args = o.arguments || o.parameters || (o.function && o.function.arguments) || {};
      if (name && tools.some(t => t.name === name)) return { name, input: args }; } catch (e) { /* not a call */ }
    return null;
  }
  return {
    name: 'ollama', kind: 'local', model,
    available() { return true; },                                                  // configured; reachability is checked when it is used
    async health() {
      try { const j = await http('/api/tags', null, null, 2000); const names = (j.models || []).map(x => x.name || x.model);
        return { reachable: true, models: names, modelPulled: names.some(n => n === model || n.split(':')[0] === model.split(':')[0] && model.indexOf(':') < 0) || names.includes(model) }; }
      catch (e) { return { reachable: false, models: [], modelPulled: false, error: e.userMessage || e.message }; }
    },
    async plan({ system, messages, tools, signal }) {
      const j = await http('/api/chat', { model, stream: false, options: { temperature: 0, num_ctx: 4096 },
        messages: [{ role: 'system', content: system.stable + '\n' + system.perUser + '\n' + FEWSHOT }].concat(toOllama(messages)),
        tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }, signal, timeoutMs);
      const usage = { input: j.prompt_eval_count || 0, output: j.eval_count || 0, cacheRead: 0 }, msg = j.message || {};
      const tc = Array.isArray(msg.tool_calls) && msg.tool_calls[0];
      if (tc && tc.function) {
        let args = tc.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { /* left as text: validation rejects it and the model is told */ } }
        return { kind: 'call', name: tc.function.name, input: args, toolUseId: null, raw: null, usage, model };
      }
      const fromText = callFromText(msg.content, tools);
      if (fromText) return { kind: 'call', name: fromText.name, input: fromText.input, toolUseId: null, raw: null, usage, model };
      return { kind: 'final', text: String(msg.content || '').trim() || '(The local model returned no text.)', raw: null, usage, model };
    }
  };
}
module.exports = { createOllama, OllamaError, FEWSHOT };
