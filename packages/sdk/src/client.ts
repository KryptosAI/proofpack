import { ProofEventPayload, ProofEvent, ProofEventCallback } from './types';
import { v4 as uuid } from 'uuid';

export interface ProofPackOptions {
  apiKey: string;
  endpoint?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  onFlush?: ProofEventCallback;
  disabled?: boolean;
}

export class ProofPack {
  private apiKey: string;
  private endpoint: string;
  private flushIntervalMs: number;
  private maxBatchSize: number;
  private onFlush?: ProofEventCallback;
  private disabled: boolean;

  private queue: ProofEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: ProofPackOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? 'https://api.proofpack.dev/v1/events';
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.maxBatchSize = options.maxBatchSize ?? 50;
    this.onFlush = options.onFlush;
    this.disabled = options.disabled ?? false;
    this.startFlushTimer();
  }

  track(payload: ProofEventPayload): ProofEvent {
    const event: ProofEvent = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      ...payload,
    };

    if (!this.disabled) {
      this.queue.push(event);
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      }
    }

    return event;
  }

  async trackAsync(payload: ProofEventPayload): Promise<ProofEvent> {
    const event = this.track(payload);
    await this.flush();
    return event;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0 || this.disabled) return;

    this.flushing = true;
    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-ProofPack-SDK': 'js/1.0.0',
        },
        body: JSON.stringify({ events: batch }),
      });
      this.onFlush?.(batch);
    } catch {
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  private startFlushTimer(): void {
    if (typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  getUserProofs(userId: string): ProofEvent[] {
    return this.queue.filter((e) => e.userId === userId);
  }

  isDisabled(): boolean {
    return this.disabled;
  }
}

let defaultInstance: ProofPack | null = null;

export function init(options: ProofPackOptions): ProofPack {
  defaultInstance = new ProofPack(options);
  return defaultInstance;
}

export function getInstance(): ProofPack | null {
  return defaultInstance;
}

export function track(payload: ProofEventPayload): ProofEvent | null {
  return defaultInstance?.track(payload) ?? null;
}

export function shutdown(): void {
  defaultInstance?.shutdown();
  defaultInstance = null;
}
