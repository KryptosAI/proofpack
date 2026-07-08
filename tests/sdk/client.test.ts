import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// We need to import after setting up the mock
describe('ProofPack SDK', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ received: 1 }) });
  });

  it('exports all required modules', async () => {
    const sdk = await import('../../packages/sdk/src/index');
    expect(sdk.ProofPack).toBeDefined();
    expect(sdk.ProofEventType).toBeDefined();
    expect(sdk.init).toBeDefined();
    expect(sdk.track).toBeDefined();
    expect(sdk.shutdown).toBeDefined();
  });

  it('creates events with automatic IDs and timestamps', async () => {
    const { ProofPack } = await import('../../packages/sdk/src/index');

    const pp = new ProofPack({
      apiKey: 'test_key',
      endpoint: 'http://localhost:3001/api/events',
      flushIntervalMs: 99999,
    });

    const ev = pp.track({
      userId: 'user_123',
      event: 'output.generated',
      metadata: { model: 'gpt-4' },
    });

    expect(ev.id).toBeDefined();
    expect(ev.timestamp).toBeDefined();
    expect(ev.userId).toBe('user_123');
    expect(ev.event).toBe('output.generated');
    expect(ev.metadata?.model).toBe('gpt-4');

    pp.shutdown();
  });

  it('respects disabled mode', async () => {
    const { ProofPack } = await import('../../packages/sdk/src/index');

    const pp = new ProofPack({
      apiKey: 'test_key',
      endpoint: 'http://localhost:3001/api/events',
      disabled: true,
    });

    const ev = pp.track({ userId: 'user_1', event: 'test' });
    expect(ev).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
    pp.shutdown();
  });

  it('flushes when batch size is reached', async () => {
    const { ProofPack } = await import('../../packages/sdk/src/index');

    const pp = new ProofPack({
      apiKey: 'test_key',
      endpoint: 'http://localhost:3001/api/events',
      maxBatchSize: 2,
      flushIntervalMs: 99999,
    });

    pp.track({ userId: 'u1', event: 'e1' });
    expect(mockFetch).not.toHaveBeenCalled();

    pp.track({ userId: 'u2', event: 'e2' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.events).toHaveLength(2);

    pp.shutdown();
  });
});
