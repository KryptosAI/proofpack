import React, { createContext, useContext, useEffect, useCallback, useRef, ReactNode } from 'react';
import { ProofPack, ProofPackOptions, ProofEventPayload, ProofEvent, ProofEventType } from '@proofpack/sdk';

interface ProofPackContextValue {
  track: (payload: ProofEventPayload) => ProofEvent | null;
  trackAsync: (payload: ProofEventPayload) => Promise<ProofEvent | null>;
  flush: () => Promise<void>;
  isReady: boolean;
  client: ProofPack | null;
}

const ProofPackContext = createContext<ProofPackContextValue>({
  track: () => null,
  trackAsync: async () => { throw new Error('ProofPack not initialized'); },
  flush: async () => {},
  isReady: false,
  client: null,
});

export function useProofPack(): ProofPackContextValue {
  return useContext(ProofPackContext);
}

interface ProofPackProviderProps {
  options: ProofPackOptions;
  children: ReactNode;
}

export function ProofPackProvider({ options, children }: ProofPackProviderProps) {
  const clientRef = useRef<ProofPack | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  useEffect(() => {
    const client = new ProofPack(options);
    clientRef.current = client;
    setIsReady(true);

    return () => {
      client.shutdown();
      clientRef.current = null;
      setIsReady(false);
    };
  }, [options.apiKey, options.endpoint, options.flushIntervalMs, options.maxBatchSize]);

  const track = useCallback((payload: ProofEventPayload): ProofEvent | null => {
    return clientRef.current?.track(payload) ?? null;
  }, []);

  const trackAsync = useCallback(async (payload: ProofEventPayload): Promise<ProofEvent | null> => {
    return clientRef.current?.trackAsync(payload) ?? null;
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    await clientRef.current?.flush();
  }, []);

  return React.createElement(
    ProofPackContext.Provider,
    {
      value: {
        track,
        trackAsync,
        flush,
        isReady,
        client: clientRef.current,
      },
    },
    children
  );
}

export function useTrackEvent() {
  const { track } = useProofPack();
  return useCallback(
    (event: ProofEventType | string, metadata?: Record<string, unknown>) => {
      return track({
        userId: 'current', // override this or set via context
        event,
        metadata,
      });
    },
    [track]
  );
}

export function useTrackPageView(metadata?: Record<string, unknown>) {
  const { track, isReady } = useProofPack();

  useEffect(() => {
    if (!isReady) return;
    track({
      userId: 'current',
      event: 'feature.used',
      metadata: { page: window.location.pathname, ...metadata },
    });
  }, []);
}

export function withProofPack(WrappedComponent: React.ComponentType<any>) {
  return function ProofPackWrapper(props: any) {
    const { track } = useProofPack();
    return React.createElement(WrappedComponent, { ...props, trackProofEvent: track });
  };
}

export { ProofEventType };
export type { ProofEventPayload, ProofEvent, ProofPackOptions };
