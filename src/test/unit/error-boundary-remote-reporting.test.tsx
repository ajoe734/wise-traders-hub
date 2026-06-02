import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('web-vitals/attribution', () => ({
  onCLS: () => {},
  onFCP: () => {},
  onINP: () => {},
  onLCP: () => {},
  onTTFB: () => {},
}));
import { render, screen, act } from '@testing-library/react';
import { createElement as h } from 'react';
import { ErrorBoundary } from '@/checkup/components/ErrorBoundary.jsx';
import {
  registerRuntimeDiagnosticsSink,
  clearRuntimeDiagnosticsSinks,
  flushRuntimeDiagnosticsQueue,
  resetRuntimeDiagnosticsState,
} from '@/checkup/lib/runtimeLogger.js';

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

function Ok() {
  return h('div', null, 'ok-child');
}

describe('ErrorBoundary remote reporting', () => {
  beforeEach(() => {
    resetRuntimeDiagnosticsState();
    // Enable remote pipeline with deterministic sample rate.
    (window as any).__PORTFOLIO_RUNTIME_MONITORING__ = {
      sampleRate: 1,
      analytics: { enabled: false },
      sentry: { enabled: false },
      queue: { flushIntervalMs: 10, batchSize: 50 },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    clearRuntimeDiagnosticsSinks();
    resetRuntimeDiagnosticsState();
    delete (window as any).__PORTFOLIO_RUNTIME_MONITORING__;
    vi.restoreAllMocks();
  });

  it('renders children normally without invoking the sink', async () => {
    const sink = { name: 'test', send: vi.fn().mockResolvedValue({ ok: true }) };
    registerRuntimeDiagnosticsSink(sink);

    render(h(ErrorBoundary, { title: '測試' }, h(Ok)));

    expect(screen.getByText('ok-child')).toBeInTheDocument();
    await flushRuntimeDiagnosticsQueue();
    expect(sink.send).not.toHaveBeenCalled();
  });

  it('catches render errors, shows fallback UI, and ships diagnostic to remote sink', async () => {
    const sink = { name: 'test', send: vi.fn().mockResolvedValue({ ok: true }) };
    registerRuntimeDiagnosticsSink(sink);

    render(h(ErrorBoundary, { title: '持倉', description: 'desc' }, h(Boom)));

    // Fallback UI rendered — child tree is isolated.
    expect(screen.getByText(/持倉.*發生錯誤/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試區塊' })).toBeInTheDocument();

    await act(async () => {
      await flushRuntimeDiagnosticsQueue();
    });

    expect(sink.send).toHaveBeenCalledTimes(1);
    const batch = sink.send.mock.calls[0][0];
    expect(Array.isArray(batch)).toBe(true);
    const entry = batch.find((e: any) => e.kind === 'error-boundary');
    expect(entry).toBeTruthy();
    expect(entry.error.message).toContain('kaboom');
    expect(entry.level).toBe('error');
  });

  it('does not throw or block rendering when sink itself rejects', async () => {
    const sink = {
      name: 'broken',
      send: vi.fn().mockRejectedValue(new Error('network down')),
    };
    registerRuntimeDiagnosticsSink(sink);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(h(ErrorBoundary, { title: 'X' }, h(Boom)));

    expect(screen.getByText(/X.*發生錯誤/)).toBeInTheDocument();

    await act(async () => {
      await flushRuntimeDiagnosticsQueue();
    });

    expect(sink.send).toHaveBeenCalled();
    // Flush logs the failure but never re-throws.
    expect(warnSpy).toHaveBeenCalled();
  });
});
