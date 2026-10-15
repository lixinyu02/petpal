import { createHash } from 'node:crypto';
import { CODEX_TOOL_VERSION } from './codex-config.mjs';

export const isOfficialProvider = provider => provider?.source === 'official-account';

// These are capabilities for the process-local gateway, never OpenAI tokens.
// Keep them outside shared state and retain revoked keys for late error frames.
export function createOfficialProviderScope(accounts) {
  const secrets = new Set();
  const forUser = userId => {
    const providers = accounts?.providers(userId) ?? [];
    for (const provider of providers) if (provider.apiKey) secrets.add(provider.apiKey);
    return providers;
  };
  const config = (provider, userId, revision) => {
    const bytes = createHash('sha256').update(JSON.stringify([revision, userId, provider.id, provider.officialProfileId, provider.baseUrl, provider.apiKey])).digest().subarray(0, 16);
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const hex = bytes.toString('hex');
    return { mode: 'api', baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey || '', reasoningEffort: provider.reasoningEffort || '',
      revision: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, toolVersion: CODEX_TOOL_VERSION };
  };
  return { forUser, config, secrets };
}

export function publicOfficialProvider(provider) {
  return { id: provider.id, name: provider.name, protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: provider.model,
    reasoningEffort: provider.reasoningEffort || '', supportsImages: provider.supportsImages === true,
    source: 'official-account', hasApiKey: false, editable: false, testable: true };
}
