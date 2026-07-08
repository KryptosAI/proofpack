import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiGet, apiPost } from '../api';

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiGet('/disputes');
      setDisputes(data.disputes);
    } catch {
      toast.error('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSeed = async () => {
    try {
      const result = await apiPost('/demo/seed');
      toast.success(`Seeded ${result.seeded} events + 1 dispute`);
      load();
    } catch {
      toast.error('Failed to seed demo data');
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      needs_response: 'badge-warning',
      won: 'badge-success',
      lost: 'badge-danger',
      under_review: 'badge-warning',
      warning_needs_response: 'badge-warning',
      warning_under_review: 'badge-warning',
      charge_refunded: 'badge-success',
    };
    return <span className={`badge ${map[status] ?? 'badge-warning'}`}>{(status ?? '').replace(/_/g, ' ')}</span>;
  };

  if (loading) return <div className="loading">Loading disputes...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Disputes</h1>
        <p>Manage chargeback disputes and generate evidence packets</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{disputes.length}</div><div className="stat-label">Total Disputes</div></div>
        <div className="stat-card"><div className="stat-value">{disputes.filter(d => d.status === 'needs_response').length}</div><div className="stat-label">Need Response</div></div>
        <div className="stat-card"><div className="stat-value">{disputes.filter(d => d.status === 'won').length}</div><div className="stat-label">Won</div></div>
        <div className="stat-card"><div className="stat-value">{disputes.filter(d => d.status === 'lost').length}</div><div className="stat-label">Lost</div></div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>All Disputes</span>
          <button className="btn btn-secondary btn-sm" onClick={handleSeed}>Seed Demo Data</button>
        </div>

        {disputes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h3>No disputes yet</h3>
            <p>Click "Seed Demo Data" to create sample disputes, or wait for your first webhook.</p>
            <button className="btn btn-primary" onClick={handleSeed}>Seed Demo Data</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Dispute ID</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Fraud</th>
                <th>Due By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td><span className="text-mono">{d.stripe_dispute_id}</span></td>
                  <td><span className="text-mono">{d.customer_id}</span></td>
                  <td>${(d.amount / 100).toFixed(2)} {d.currency.toUpperCase()}</td>
                  <td style={{ textTransform: 'capitalize' }}>{(d.reason ?? '').replace(/_/g, ' ')}</td>
                  <td>{statusBadge(d.status)}</td>
                  <td>
                    {d.fraud_score != null ? (
                      <span className={`badge ${d.fraud_score >= 50 ? 'badge-danger' : d.fraud_score >= 25 ? 'badge-warning' : 'badge-success'}`}>
                        {d.fraud_score}/100
                      </span>
                    ) : '—'}
                  </td>
                  <td>{d.evidence_due_by ? new Date(d.evidence_due_by).toLocaleDateString() : '—'}</td>
                  <td><Link to={`/disputes/${d.id}`} className="btn btn-secondary btn-sm">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
