'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { PROVIDERS, CUSTOM_PROVIDER_ID, type CredentialType, type ModelOption, type CustomApiFormat } from '@clawhuddle/shared';

type FetchFn = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface ApiKeyDisplay {
  id: string;
  provider: string;
  key_masked: string;
  is_company_default: boolean;
  credential_type?: CredentialType;
  default_model?: string | null;
  base_url?: string | null;
  api_format?: string | null;
  custom_label?: string | null;
}

interface Props {
  initialKeys: ApiKeyDisplay[];
  fetchFn: FetchFn;
}

const CRED_TYPE_LABEL: Record<CredentialType, string> = {
  api_key: 'API Key',
  token: 'Setup Token',
  oauth: 'OAuth Token',
};

function getAvailableTabs(provider: (typeof PROVIDERS)[number]): CredentialType[] {
  // OAuth-only providers (no envVar) only show oauth tab
  if (provider.supportsOAuth && !provider.envVar) return ['oauth'];
  const tabs: CredentialType[] = ['api_key'];
  if (provider.supportsSetupToken) tabs.push('token');
  if (provider.supportsOAuth) tabs.push('oauth');
  return tabs;
}

export function ApiKeyForm({ initialKeys, fetchFn }: Props) {
  const { toast } = useToast();
  const [keys, setKeys] = useState(initialKeys);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [credTabs, setCredTabs] = useState<Record<string, CredentialType>>({});
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(() => {
    // Initialize from existing keys
    const init: Record<string, string> = {};
    for (const k of initialKeys) {
      if (k.default_model) init[k.provider] = k.default_model;
    }
    return init;
  });

  const refresh = async () => {
    const res = await fetchFn<{ data: ApiKeyDisplay[] }>('/api-keys');
    setKeys(res.data);
  };

  const saveKey = async (provider: string) => {
    const key = inputs[provider]?.trim();
    if (!key) return;
    const providerConfig = PROVIDERS.find((p) => p.id === provider);
    const tabs = providerConfig ? getAvailableTabs(providerConfig) : ['api_key' as const];
    const credentialType: CredentialType = credTabs[provider] ?? tabs[0];

    // Validate OAuth JSON before sending
    if (credentialType === 'oauth') {
      try {
        const parsed = JSON.parse(key);
        // Codex auth.json nests tokens under "tokens"
        const tokens = parsed.tokens ?? parsed;
        if (!tokens.access_token || !tokens.refresh_token) {
          toast('Invalid auth.json — must contain access_token and refresh_token', 'error');
          return;
        }
      } catch {
        toast('Invalid JSON — paste the full contents of auth.json', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const providerCfg = PROVIDERS.find((p) => p.id === provider);
      const defaultModel = providerCfg?.models ? (selectedModels[provider] || providerCfg.defaultModel) : undefined;
      await fetchFn('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider, key, credentialType, defaultModel }),
      });
      setInputs((prev) => ({ ...prev, [provider]: '' }));
      await refresh();
      const label = providerConfig?.label ?? provider;
      toast(`${label} ${CRED_TYPE_LABEL[credentialType]?.toLowerCase() ?? 'key'} saved`, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = async (keyId: string, providerLabel: string) => {
    setSaving(true);
    try {
      await fetchFn(`/api-keys/${keyId}`, { method: 'DELETE' });
      await refresh();
      toast(`${providerLabel} key deleted`, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateModel = async (keyId: string, provider: string, model: string) => {
    setSelectedModels((prev) => ({ ...prev, [provider]: model }));
    try {
      await fetchFn(`/api-keys/${keyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ defaultModel: model }),
      });
      await refresh();
      toast('Default model updated', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Custom provider state
  const [customLabel, setCustomLabel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiFormat, setCustomApiFormat] = useState<CustomApiFormat>('openai-completions');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModelName, setCustomModelName] = useState('');

  const currentKey = (provider: string) => keys.find((k) => k.provider === provider);
  const existingCustom = currentKey(CUSTOM_PROVIDER_ID);

  const saveCustomProvider = async () => {
    if (!customBaseUrl.trim() || !customApiKey.trim() || !customModelName.trim()) {
      toast('Base URL, API Key, and Model Name are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await fetchFn('/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          provider: CUSTOM_PROVIDER_ID,
          key: customApiKey.trim(),
          baseUrl: customBaseUrl.trim(),
          apiFormat: customApiFormat,
          defaultModel: customModelName.trim(),
          customLabel: customLabel.trim() || undefined,
        }),
      });
      setCustomLabel('');
      setCustomBaseUrl('');
      setCustomApiKey('');
      setCustomModelName('');
      await refresh();
      toast('Custom provider saved', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      {PROVIDERS.map((providerConfig) => {
        const { id, label, placeholder, defaultModel, models, supportsSetupToken, setupTokenInstructions, supportsOAuth, oauthInstructions } = providerConfig;
        const existing = currentKey(id);
        const tabs = getAvailableTabs(providerConfig);
        const activeTab = credTabs[id] ?? tabs[0];
        const currentModel = selectedModels[id] || existing?.default_model || defaultModel;
        return (
          <div
            key={id}
            className="p-5 rounded-xl"
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="flex items-baseline justify-between mb-1">
              <h3
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {label}
              </h3>
              {models ? (
                <select
                  value={currentModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (existing) {
                      updateModel(existing.id, id, val);
                    } else {
                      setSelectedModels((prev) => ({ ...prev, [id]: val }));
                    }
                  }}
                  className="text-[11px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <span
                  className="text-[11px] font-mono"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {defaultModel}
                </span>
              )}
            </div>

            {existing && (
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    background: existing.credential_type === 'api_key' ? 'var(--bg-tertiary)' : 'var(--accent-muted, rgba(99,102,241,0.15))',
                    color: existing.credential_type === 'api_key' ? 'var(--text-tertiary)' : 'var(--accent)',
                  }}
                >
                  {CRED_TYPE_LABEL[existing.credential_type ?? 'api_key']}
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  <code
                    className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                  >
                    {existing.key_masked}
                  </code>
                </p>
                <button
                  onClick={() => deleteKey(existing.id, label)}
                  disabled={saving}
                  className="text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                  style={{ color: 'var(--text-tertiary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error, #ef4444)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                >
                  Delete
                </button>
              </div>
            )}

            {tabs.length > 1 && (
              <div className="flex gap-1 mb-3">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCredTabs((prev) => ({ ...prev, [id]: tab }))}
                    className="px-3 py-1 text-xs font-medium rounded-md transition-all"
                    style={{
                      background: activeTab === tab ? 'var(--accent)' : 'transparent',
                      color: activeTab === tab ? 'var(--text-inverse)' : 'var(--text-tertiary)',
                      border: activeTab === tab ? 'none' : '1px solid var(--border-subtle)',
                    }}
                  >
                    {CRED_TYPE_LABEL[tab]}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'token' && setupTokenInstructions && (
              <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                {setupTokenInstructions}
              </p>
            )}

            {activeTab === 'oauth' && oauthInstructions && (
              <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                {oauthInstructions}
              </p>
            )}

            <div className="flex gap-2">
              {activeTab === 'oauth' ? (
                <textarea
                  value={inputs[id] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder='{"access_token": "...", "refresh_token": "...", "expires_at": "..."}'
                  rows={3}
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-lg resize-none"
                />
              ) : (
                <input
                  type="password"
                  value={inputs[id] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder={
                    activeTab === 'token' ? 'Paste setup token...' : placeholder
                  }
                  className="flex-1 px-3 py-2 text-sm rounded-lg"
                />
              )}
              <button
                onClick={() => saveKey(id)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 self-end"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--text-inverse)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
              >
                Save
              </button>
            </div>
          </div>
        );
      })}

      {/* Custom Provider Section */}
      <div
        className="p-5 rounded-xl"
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          Custom Provider
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Connect a third-party LLM API (OpenAI-compatible or Anthropic-compatible).
        </p>

        {existingCustom ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                {existingCustom.custom_label || 'Custom'}
              </span>
              <code
                className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                {existingCustom.key_masked}
              </code>
              <button
                onClick={() => deleteKey(existingCustom.id, existingCustom.custom_label || 'Custom provider')}
                disabled={saving}
                className="text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                style={{ color: 'var(--text-tertiary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error, #ef4444)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              >
                Delete
              </button>
            </div>
            <div className="text-[11px] font-mono space-y-0.5" style={{ color: 'var(--text-tertiary)' }}>
              <div>URL: {existingCustom.base_url}</div>
              <div>Format: {existingCustom.api_format}</div>
              <div>Model: {existingCustom.default_model}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Display Name (optional)"
              className="w-full px-3 py-2 text-sm rounded-lg"
            />
            <input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="Base URL (e.g. https://api.example.com/v1)"
              className="w-full px-3 py-2 text-sm rounded-lg"
            />
            <select
              value={customApiFormat}
              onChange={(e) => setCustomApiFormat(e.target.value as CustomApiFormat)}
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <option value="openai-completions">OpenAI Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
            <input
              type="password"
              value={customApiKey}
              onChange={(e) => setCustomApiKey(e.target.value)}
              placeholder="API Key"
              className="w-full px-3 py-2 text-sm rounded-lg"
            />
            <input
              type="text"
              value={customModelName}
              onChange={(e) => setCustomModelName(e.target.value)}
              placeholder="Model Name (e.g. gpt-4o)"
              className="w-full px-3 py-2 text-sm rounded-lg"
            />
            <button
              onClick={saveCustomProvider}
              disabled={saving}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: 'var(--text-inverse)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
            >
              Save Custom Provider
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
