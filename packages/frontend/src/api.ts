import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

const API_BASE = '/api';

let cachedApiKey: string | null = null;

export function setApiKey(key: string) {
  cachedApiKey = key;
  localStorage.setItem('proofpack_api_key', key);
}

export function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  cachedApiKey = localStorage.getItem('proofpack_api_key') ?? 'ppk_demo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  return cachedApiKey;
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getApiKey()}`,
  };
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export function pdfUrl(disputeId: string): string {
  return `${API_BASE}/disputes/${disputeId}/pdf`;
}

export function useApiKey() {
  const [key, setKey] = useState(getApiKey);

  useEffect(() => {
    const stored = localStorage.getItem('proofpack_api_key');
    if (stored && stored !== key) setKey(stored);
  }, []);

  const updateKey = (newKey: string) => {
    setApiKey(newKey);
    setKey(newKey);
  };

  return { apiKey: key, setApiKey: updateKey };
}

export function useDashboardStats() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { stats, loading, refetch: () => apiGet('/stats').then(setStats) };
}
