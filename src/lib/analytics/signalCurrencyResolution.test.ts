import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSignalCurrencyResolutionPayload } from './signalCurrencyResolution';
import { trackRaw } from './events';

vi.mock('./events', () => ({
  trackRaw: vi.fn(),
}));

describe('buildSignalCurrencyResolutionPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explicit USD from experts → source=explicit, had_explicit=true', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-1',
      expert_slug: 'zhou',
      expert_currency: 'USD',
      instrument: 'AAPL',
      is_preview: false,
    });
    expect(payload).toMatchObject({
      signal_id: 'sig-1',
      expert_slug: 'zhou',
      instrument: 'AAPL',
      resolved_currency: 'USD',
      source: 'explicit',
      had_explicit: true,
      is_preview: false,
    });
  });

  it('explicit TWD from experts → source=explicit, had_explicit=true', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-2',
      expert_slug: null,
      expert_currency: 'TWD',
      instrument: '2330',
      is_preview: true,
    });
    expect(payload.resolved_currency).toBe('TWD');
    expect(payload.source).toBe('explicit');
    expect(payload.had_explicit).toBe(true);
    expect(payload.is_preview).toBe(true);
    expect(payload.expert_slug).toBeNull();
  });

  it('missing currency + TW ticker → inferred TWD, had_explicit=false', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-3',
      expert_slug: 'foo',
      expert_currency: null,
      instrument: '2330 台積電',
      is_preview: false,
    });
    expect(payload.resolved_currency).toBe('TWD');
    expect(payload.source).toBe('inferred-instrument');
    expect(payload.had_explicit).toBe(false);
  });

  it('missing currency + US ticker → inferred USD, had_explicit=false', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-4',
      expert_slug: 'bar',
      expert_currency: undefined,
      instrument: 'TSLA',
      is_preview: false,
    });
    expect(payload.resolved_currency).toBe('USD');
    expect(payload.source).toBe('inferred-instrument');
    expect(payload.had_explicit).toBe(false);
  });

  it('completely empty → default-fallback TWD, instrument coerced to null', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-5',
      expert_slug: null,
      expert_currency: null,
      instrument: null,
      is_preview: false,
    });
    expect(payload.resolved_currency).toBe('TWD');
    expect(payload.source).toBe('default-fallback');
    expect(payload.had_explicit).toBe(false);
    expect(payload.instrument).toBeNull();
  });

  it('non-USD/TWD explicit value (e.g. JPY) → had_explicit=false', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-6',
      expert_slug: 'x',
      expert_currency: 'JPY',
      instrument: '7203',
      is_preview: false,
    });
    // had_explicit 只認 USD/TWD（目前支援幣別）
    expect(payload.had_explicit).toBe(false);
  });
});

describe('trackRaw("signal_currency_resolution") 契約', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trackRaw 收到的 payload 帶正確的 source / resolved_currency / had_explicit', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-track-1',
      expert_slug: 'zhou',
      expert_currency: 'USD',
      instrument: 'NVDA',
      is_preview: true,
    });
    trackRaw('signal_currency_resolution', payload);

    expect(trackRaw).toHaveBeenCalledTimes(1);
    expect(trackRaw).toHaveBeenCalledWith(
      'signal_currency_resolution',
      expect.objectContaining({
        signal_id: 'sig-track-1',
        resolved_currency: 'USD',
        source: 'explicit',
        had_explicit: true,
        is_preview: true,
      }),
    );
  });

  it('trackRaw payload 對 inferred 情境送出正確的 source 標記', () => {
    const payload = buildSignalCurrencyResolutionPayload({
      signal_id: 'sig-track-2',
      expert_slug: null,
      expert_currency: null,
      instrument: '2330',
      is_preview: false,
    });
    trackRaw('signal_currency_resolution', payload);

    expect(trackRaw).toHaveBeenCalledWith(
      'signal_currency_resolution',
      expect.objectContaining({
        resolved_currency: 'TWD',
        source: 'inferred-instrument',
        had_explicit: false,
      }),
    );
  });
});
