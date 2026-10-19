// A small JSON-Schema checker (the subset tools need). Tool inputs are validated here before anything runs; unknown fields are rejected, never ignored.
'use strict';

function check(schema, v, path) {
  const err = m => ({ ok: false, error: (path || 'input') + ' ' + m });
  switch (schema.type) {
    case 'object': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return err('must be an object');
      const props = schema.properties || {};
      for (const k of Object.keys(v)) if (!(k in props)) return err('has an unknown field "' + k + '"');
      for (const k of schema.required || []) if (v[k] === undefined) return err('is missing "' + k + '"');
      for (const k of Object.keys(props)) if (v[k] !== undefined) { const r = check(props[k], v[k], k); if (!r.ok) return r; }
      return { ok: true };
    }
    case 'string': {
      if (typeof v !== 'string') return err('must be text');
      const t = v.trim();
      if (schema.minLength !== undefined && t.length < schema.minLength) return err('is too short');
      if (schema.maxLength !== undefined && v.length > schema.maxLength) return err('is too long (maximum ' + schema.maxLength + ')');
      if (schema.enum && !schema.enum.includes(v)) return err('must be one of: ' + schema.enum.join(', '));
      if (schema.format === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')))) return err('must be a date like 2026-10-23');
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) return err('has the wrong format');
      return { ok: true };
    }
    case 'integer': return Number.isInteger(v) && (schema.minimum === undefined || v >= schema.minimum) && (schema.maximum === undefined || v <= schema.maximum) ? { ok: true } : err('must be a whole number' + (schema.minimum !== undefined ? ' of at least ' + schema.minimum : ''));
    case 'boolean': return typeof v === 'boolean' ? { ok: true } : err('must be true or false');
    default: return err('has an unsupported schema type');
  }
}
const validate = (schema, value) => check(schema, value, 'input');
module.exports = { validate };
