import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useApiKey, useDashboardStats, apiGet, apiPost, apiPut, apiDelete, setApiKey } from '../api';

export default function SettingsPage() {
  const { apiKey, setApiKey: updateKey } = useApiKey();
  const { stats } = useDashboardStats();
  const [merchant, setMerchant] = useState<any>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [alertConfigs, setAlertConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const [alertForm, setAlertForm] = useState({
    alert_type: 'dispute',
    channel: 'email',
    config: { to: '', webhook_url: '' },
    events: ['charge.dispute.created'],
  });

  useEffect(() => {
    loadAll();
  }, [apiKey]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [mData, cData, aData] = await Promise.all([
        apiGet('/merchant'),
        apiGet('/connect/status'),
        apiGet('/alerts'),
      ]);
      setMerchant(mData.merchant);
      setApiKeys(mData.apiKeys);
      setConnected(cData.connected);
      setAlertConfigs(aData.configs);
    } catch {
      // use demo key
    } finally {
      setLoading(false);
    }
  };

  const handleCreateApiKey = async () => {
    try {
      const result = await apiPost('/merchant/api-keys', { name: newKeyName || 'Custom' });
      setNewKeyName('');
      toast.success('API key created');
      loadAll();
    } catch {
      toast.error('Failed to create key');
    }
  };

  const handleRevokeKey = async (key: string) => {
    try {
      await apiDelete(`/merchant/api-keys/${key}`);
      toast.success('Key revoked');
      loadAll();
    } catch {
      toast.error('Failed to revoke key');
    }
  };

  const handleConnectStripe = async () => {
    try {
      const data = await apiGet('/connect/authorize');
      window.open(data.url, '_blank');
    } catch {
      toast.error('Failed to start Connect flow');
    }
  };

  const handleDisconnectStripe = async () => {
    try {
      await apiDelete('/connect/disconnect');
      setConnected(false);
      toast.success('Stripe account disconnected');
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const handleAddAlert = async () => {
    try {
      await apiPost('/alerts', alertForm);
      setAlertForm({ ...alertForm, config: { to: '', webhook_url: '' } });
      toast.success('Alert configured');
      loadAll();
    } catch {
      toast.error('Failed to save alert');
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      await apiDelete(`/alerts/${id}`);
      toast.success('Alert removed');
      loadAll();
    } catch {
      toast.error('Failed to remove alert');
    }
  };

  const handleToggleAlert = async (id: string, active: boolean) => {
    try {
      await apiPut(`/alerts/${id}`, { active: active ? 1 : 0 });
      loadAll();
    } catch {
      toast.error('Failed to toggle');
    }
  };

  if (loading) return <div className="loading">Loading settings...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage Stripe connection, API keys, and alert preferences</p>
      </div>

      {/* API Key */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Current API Key</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="text"
            value={apiKey}
            readOnly
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontFamily: 'monospace', fontSize: 13, background: '#f9fafb' }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => setShowApiKeyInput(!showApiKeyInput)}>Change</button>
        </div>
        {showApiKeyInput && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="ppk_..."
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { updateKey((e.target as HTMLInputElement).value); setShowApiKeyInput(false); toast.success('API key updated'); } }}
            />
            <button className="btn btn-primary btn-sm" onClick={(e) => {
              const input = (e.currentTarget.previousSibling as HTMLInputElement);
              if (input.value) { updateKey(input.value); setShowApiKeyInput(false); toast.success('API key updated'); }
            }}>Save</button>
          </div>
        )}
      </div>

      {/* Stripe Connect */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Stripe Connect</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Connect your Stripe account to auto-submit evidence and sync disputes in real-time.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: connected ? '#10b981' : '#d1d5db', display: 'inline-block' }}></span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{connected ? 'Connected' : 'Not Connected'}</span>
          </div>
          {connected ? (
            <button className="btn btn-secondary btn-sm" onClick={handleDisconnectStripe}>Disconnect</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={handleConnectStripe}>Connect Stripe Account</button>
          )}
        </div>
      </div>

      {/* API Keys */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>API Keys</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="text" placeholder="Key name (e.g. Production)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleCreateApiKey}>Create Key</button>
        </div>
        <table>
          <thead><tr><th>Key</th><th>Name</th><th>Last Used</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {apiKeys.map((k: any) => (
              <tr key={k.key}>
                <td><span className="text-mono">{k.key.slice(0, 12)}...{k.key.slice(-8)}</span></td>
                <td>{k.name}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                <td><span className={`badge ${k.active ? 'badge-success' : 'badge-danger'}`}>{k.active ? 'Active' : 'Revoked'}</span></td>
                <td>{k.active ? <button className="btn btn-secondary btn-sm" onClick={() => handleRevokeKey(k.key)}>Revoke</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Alerts */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Alert Configuration</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Get notified when disputes are created or resolved.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channel</label>
            <select
              value={alertForm.channel}
              onChange={(e) => setAlertForm({ ...alertForm, channel: e.target.value })}
              style={{ width: '100%', padding: '8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}
            >
              <option value="email">Email</option>
              <option value="slack">Slack</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              {alertForm.channel === 'email' ? 'Email Address' : alertForm.channel === 'slack' ? 'Webhook URL' : 'URL'}
            </label>
            <input
              type="text"
              placeholder={alertForm.channel === 'email' ? 'you@company.com' : 'https://...'}
              value={alertForm.channel === 'slack' ? alertForm.config.webhook_url : alertForm.config.to}
              onChange={(e) => {
                if (alertForm.channel === 'slack') {
                  setAlertForm({ ...alertForm, config: { ...alertForm.config, webhook_url: e.target.value } });
                } else {
                  setAlertForm({ ...alertForm, config: { ...alertForm.config, to: e.target.value } });
                }
              }}
              style={{ width: '100%', padding: '8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleAddAlert}>Add Alert</button>

        {alertConfigs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>Type</th><th>Channel</th><th>Events</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {alertConfigs.map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.alert_type}</td>
                    <td>{a.channel}</td>
                    <td><span style={{ fontSize: 12 }}>{JSON.parse(a.events).join(', ')}</span></td>
                    <td>
                      <span className={`badge ${a.active ? 'badge-success' : 'badge-danger'}`}>
                        {a.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleToggleAlert(a.id, !a.active)}>
                        {a.active ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDeleteAlert(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Account Stats</h3>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <div className="stat-card"><div className="stat-value">{stats.totalDisputes}</div><div className="stat-label">Disputes</div></div>
            <div className="stat-card"><div className="stat-value">{stats.needsResponse}</div><div className="stat-label">Need Response</div></div>
            <div className="stat-card"><div className="stat-value">{stats.wonDisputes}</div><div className="stat-label">Won</div></div>
            <div className="stat-card"><div className="stat-value">{stats.lostDisputes}</div><div className="stat-label">Lost</div></div>
            <div className="stat-card"><div className="stat-value">{stats.winRate}%</div><div className="stat-label">Win Rate</div></div>
            <div className="stat-card"><div className="stat-value">{stats.totalEvents}</div><div className="stat-label">Events</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
