import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiGet, apiPost, pdfUrl } from '../api';

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<any>(null);
  const [fraudAnalysis, setFraudAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiGet(`/disputes/${id}`)
      .then((data) => {
        setDispute(data.dispute);
        setEvents(data.events);
        setTimeline(data.timeline);
        setEvidence(data.evidence);
        setFraudAnalysis(data.fraudAnalysis);
      })
      .catch(() => toast.error('Failed to load dispute'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownloadPdf = () => {
    if (!id) return;
    const a = document.createElement('a');
    a.href = pdfUrl(id);
    a.download = `dispute-evidence-${dispute?.stripe_dispute_id ?? id}.pdf`;
    a.click();
    toast.success('PDF downloaded');
  };

  const handleSubmitEvidence = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const result = await apiPost(`/disputes/${id}/submit`);
      if (result.submitted) {
        toast.success('Evidence submitted to Stripe!');
        const data = await apiGet(`/disputes/${id}`);
        setDispute(data.dispute);
      } else {
        toast.error('Failed to submit. Check Stripe Connect in Settings.');
      }
    } catch {
      toast.error('Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!dispute) return <div className="loading">Dispute not found</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/disputes" style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none' }}>&larr; Back</Link>
      </div>

      <div className="detail-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Dispute {dispute.stripe_dispute_id}</h1>
          <p style={{ color: '#6b7280', fontSize: 14 }}>Created {new Date(dispute.created_at).toLocaleString()}</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={handleDownloadPdf}>Download Evidence PDF</button>
          <button className="btn btn-danger" onClick={handleSubmitEvidence} disabled={submitting || dispute.evidence_submitted}>
            {submitting ? 'Submitting...' : dispute.evidence_submitted ? 'Submitted' : 'Submit to Stripe'}
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card"><div className="detail-item"><label>Stripe Dispute ID</label><span className="text-mono">{dispute.stripe_dispute_id}</span></div></div>
        <div className="card"><div className="detail-item"><label>Status</label>
          <span className={`badge ${dispute.status === 'needs_response' ? 'badge-warning' : dispute.status === 'won' ? 'badge-success' : 'badge-danger'}`}>
            {(dispute.status ?? '').replace(/_/g, ' ')}
          </span>
        </div></div>
        <div className="card"><div className="detail-item"><label>Charge ID</label><span className="text-mono">{dispute.charge_id}</span></div></div>
        <div className="card"><div className="detail-item"><label>Amount</label><span>${(dispute.amount / 100).toFixed(2)} {dispute.currency.toUpperCase()}</span></div></div>
        <div className="card"><div className="detail-item"><label>Customer</label><span className="text-mono">{dispute.customer_id}</span></div></div>
        <div className="card"><div className="detail-item"><label>Reason</label><span style={{ textTransform: 'capitalize' }}>{(dispute.reason ?? '').replace(/_/g, ' ')}</span></div></div>
      </div>

      {fraudAnalysis && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 12 }}>
            Fraud Risk Assessment
            <span style={{ marginLeft: 12, padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: fraudAnalysis.risk === 'high' ? '#fee2e2' : fraudAnalysis.risk === 'medium' ? '#fef3c7' : '#d1fae5',
              color: fraudAnalysis.risk === 'high' ? '#991b1b' : fraudAnalysis.risk === 'medium' ? '#92400e' : '#065f46'
            }}>
              {fraudAnalysis.risk.toUpperCase()} — Score: {fraudAnalysis.score}/100
            </span>
          </h3>
          <p style={{ fontSize: 13, marginBottom: 8 }}>{fraudAnalysis.recommendation}</p>
          {fraudAnalysis.flags.length > 0 && (
            <div>
              {fraudAnalysis.flags.map((f: any, i: number) => (
                <div key={i} style={{ fontSize: 12, padding: '4px 0', color: f.severity === 'high' ? '#991b1b' : f.severity === 'medium' ? '#92400e' : '#6b7280' }}>
                  [{f.severity.toUpperCase()}] {f.description}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {evidence?.sections && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Evidence Sections</h3>
          <table>
            <thead><tr><th>Section</th><th>Stripe Field</th></tr></thead>
            <tbody>
              {evidence.sections.map((s: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{s.section}</td>
                  <td style={{ fontSize: 12 }}><span className="text-mono">{s.stripeField}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Activity Timeline ({events.length} events)</h2>
      {timeline.length === 0 ? (
        <div className="card empty-state"><div className="empty-icon">📋</div><h3>No proof events yet</h3></div>
      ) : (
        <div className="card">
          <div className="timeline">
            {timeline.map((entry: any, i: number) => (
              <div key={i} className="timeline-entry">
                <h3>{entry.icon} {entry.events.title}<span className="event-badge">{entry.events.items.length} event{entry.events.items.length > 1 ? 's' : ''}</span></h3>
                {entry.events.items.map((item: string, j: number) => (
                  <div key={j} className="event-item">{item}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
