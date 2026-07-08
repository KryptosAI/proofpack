import { ProofEvent } from './types';

export interface FraudAnalysis {
  score: number;
  flags: FraudFlag[];
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface FraudFlag {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export function analyzeFraudRisk(events: ProofEvent[]): FraudAnalysis {
  const flags: FraudFlag[] = [];
  let score = 0;

  const ips = events.map((e) => e.ip_address).filter(Boolean) as string[];
  const uniqueIps = [...new Set(ips)];
  const devices = events.map((e) => e.device_id).filter(Boolean) as string[];
  const uniqueDevices = [...new Set(devices)];

  const timestamps = events.map((e) => new Date(e.timestamp).getTime()).sort();
  const firstEvent = timestamps[0];
  const lastEvent = timestamps[timestamps.length - 1];
  const durationHours = firstEvent && lastEvent ? (lastEvent - firstEvent) / 3600000 : 0;

  const signUpEvent = events.find((e) => e.event === 'user.signed_up');
  const firstPayment = events.find((e) => e.event === 'payment.completed' || e.event === 'subscription.started');

  if (uniqueIps.length > 5) {
    flags.push({ type: 'ip_volatility', description: `${uniqueIps.length} unique IPs detected`, severity: 'high' });
    score += 30;
  } else if (uniqueIps.length > 2) {
    flags.push({ type: 'ip_volatility', description: `${uniqueIps.length} unique IPs detected`, severity: 'medium' });
    score += 15;
  }

  if (uniqueDevices.length > 4) {
    flags.push({ type: 'device_volatility', description: `${uniqueDevices.length} unique devices`, severity: 'high' });
    score += 25;
  } else if (uniqueDevices.length > 2) {
    flags.push({ type: 'device_volatility', description: `${uniqueDevices.length} unique devices`, severity: 'medium' });
    score += 10;
  }

  if (signUpEvent && firstPayment) {
    const signUpTime = new Date(signUpEvent.timestamp).getTime();
    const paymentTime = new Date(firstPayment.timestamp).getTime();
    const hoursToConversion = (paymentTime - signUpTime) / 3600000;

    if (hoursToConversion < 0.1) {
      flags.push({
        type: 'rapid_conversion',
        description: `Payment within ${Math.round(hoursToConversion * 60)} minutes of sign-up`,
        severity: 'medium',
      });
      score += 20;
    }
  }

  if (durationHours > 0 && durationHours < 1 && events.length > 5) {
    flags.push({
      type: 'activity_burst',
      description: `${events.length} events in ${Math.round(durationHours * 60)} minutes`,
      severity: 'medium',
    });
    score += 15;
  }

  const downloadEvents = events.filter((e) =>
    e.event.includes('download') || e.event.includes('export')
  ).length;

  if (downloadEvents === 0 && events.length > 10) {
    flags.push({
      type: 'no_downloads',
      description: 'No downloads/exports despite active usage',
      severity: 'low',
    });
    score += 5;
  }

  if (durationHours > 720 && events.length < 5) {
    flags.push({
      type: 'low_engagement',
      description: `Only ${events.length} events over ${Math.round(durationHours / 24)} days`,
      severity: 'medium',
    });
    score += 15;
  }

  if (signUpEvent && durationHours > 0 && durationHours < 24 && events.length < 3) {
    flags.push({
      type: 'hit_and_run',
      description: 'Minimal usage then dispute within 24 hours',
      severity: 'high',
    });
    score += 35;
  }

  let risk: 'low' | 'medium' | 'high' = 'low';
  let recommendation = 'Evidence packet should be sufficient to win this dispute.';
  if (score >= 50) {
    risk = 'high';
    recommendation = 'High fraud risk. Add manual review notes and consider additional identity verification evidence.';
  } else if (score >= 25) {
    risk = 'medium';
    recommendation = 'Moderate risk detected. Ensure all evidence sections are filled and consider adding customer communication logs.';
  }

  return { score: Math.min(score, 100), flags, risk, recommendation };
}
