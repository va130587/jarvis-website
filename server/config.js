// Server configuration. Everything comes from environment variables (see .env.example). No secret is ever read from a file in the repo.
'use strict';
const path = require('path');

const list = s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const LOOPBACK = /^(127\.0\.0\.1|localhost|::1)$/;

function load(env, over) {
  env = Object.assign({}, env, over || {});
  const host = env.HOST || '127.0.0.1';
  const port = env.PORT === undefined ? 8787 : +env.PORT;
  const cfg = {
    root: path.join(__dirname, '..'),
    host, port,
    baseUrl: (env.BASE_URL || '').replace(/\/$/, ''),            // public origin, e.g. https://nova.example.com ; empty = derive from request
    dbPath: env.NOVA_DB || path.join(__dirname, '..', '.nova', 'nova.db'),
    authMode: env.AUTH_MODE || 'google',                          // 'google' | 'dev'
    ownerEmails: list(env.OWNER_EMAILS),                          // who may sign in (allow-list)
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      issuers: ['https://accounts.google.com', 'accounts.google.com']
    },
    session: { idleMs: (+env.SESSION_IDLE_MINUTES || 480) * 60e3, absoluteMs: (+env.SESSION_MAX_HOURS || 168) * 3600e3 },
    ai: {
      provider: env.NOVA_AI_PROVIDER || 'local',                  // 'local' (free, rules only) | 'ollama' (free local model) | 'claude' (needs ANTHROPIC_API_KEY)
      anthropicKey: env.ANTHROPIC_API_KEY || '',
      ollamaUrl: env.NOVA_OLLAMA_URL || 'http://127.0.0.1:11434', ollamaModel: env.NOVA_OLLAMA_MODEL || 'qwen2.5:7b', ollamaTimeoutMs: +env.NOVA_OLLAMA_TIMEOUT_MS || 60000,
      modelChat: env.NOVA_MODEL_CHAT || 'claude-sonnet-5-5',
      maxTokens: +env.NOVA_MAX_TOKENS || 800,
      monthlyLimitUsd: env.NOVA_MONTHLY_LIMIT_USD === undefined || env.NOVA_MONTHLY_LIMIT_USD === '' ? null : +env.NOVA_MONTHLY_LIMIT_USD
    },
    agent: { maxSteps: +env.NOVA_AGENT_MAX_STEPS || 5, toolTimeoutMs: +env.NOVA_TOOL_TIMEOUT_MS || 5000, runTimeoutMs: +env.NOVA_RUN_TIMEOUT_MS || 30000, approvalTtlMs: (+env.NOVA_APPROVAL_TTL_HOURS || 24) * 3600e3 },
    limits: { auth: { max: +env.NOVA_RATE_AUTH_MAX || 20, perMs: 60e3 }, api: { max: +env.NOVA_RATE_API_MAX || 240, perMs: 60e3 }, chat: { max: +env.NOVA_RATE_CHAT_MAX || 30, perMs: 60e3 } },
    now: () => Date.now()
  };
  cfg.secureCookies = /^https:/i.test(cfg.baseUrl);
  if (cfg.authMode === 'dev' && !LOOPBACK.test(host)) throw new Error('AUTH_MODE=dev is only allowed on a loopback host (127.0.0.1 or localhost).');
  if (cfg.authMode !== 'dev' && cfg.authMode !== 'google') throw new Error('AUTH_MODE must be "google" or "dev".');
  return cfg;
}
module.exports = { load };
