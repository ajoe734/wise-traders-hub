import { describe, it, expect } from 'vitest';
import {
  computeCalendarStableId,
  mergeCalendarEvents,
  mergeCalendarToNewsEvents,
} from '../calendarSync';

describe('computeCalendarStableId', () => {
  it('handles YYYY/MM/DD', () => {
    expect(computeCalendarStableId('2330 台積電 法說會', '2026/01/15', 'earnings'))
      .toBe('cal-2330-earnings-20260115');
  });
  it('handles YYYY/MM月', () => {
    expect(computeCalendarStableId('2454 聯發科 月營收', '2026/03月', 'revenue'))
      .toBe('cal-2454-revenue-202603MM');
  });
  it('handles YYYY Q1', () => {
    expect(computeCalendarStableId('2317 鴻海 季報', '2026 Q2', 'earnings'))
      .toBe('cal-2317-earnings-2026Q2');
  });
  it('falls back to tba when date missing', () => {
    expect(computeCalendarStableId('2330 台積電', '', 'event'))
      .toBe('cal-2330-event-tba');
  });
  it('falls back to na when no stock code', () => {
    expect(computeCalendarStableId('FOMC 利率決議', '2026/01/15', 'macro'))
      .toBe('cal-na-macro-20260115');
  });
});

describe('mergeCalendarEvents', () => {
  it('dedupes by label+date and sorts', () => {
    const existing = [{ label: 'A', date: '2026/01/10' }];
    const incoming = [
      { label: 'A', date: '2026/01/10' }, // dup
      { label: 'B', date: '2026/01/05' },
    ];
    const out = mergeCalendarEvents(existing, incoming, '2330,2454');
    expect(out.map(e => e.label)).toEqual(['B', 'A']);
    expect(out._holdingCodes).toBe('2330,2454');
  });
  it('skips entries without label', () => {
    const out = mergeCalendarEvents([], [{ date: '2026/01/01' }, null, { label: 'X', date: '2026/01/02' }]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('X');
  });
});

describe('mergeCalendarToNewsEvents', () => {
  it('creates new entries with stableId for unseen events', () => {
    const out = mergeCalendarToNewsEvents([], [
      { label: '2330 台積電 法說會', date: '2026/01/15', type: 'earnings', sub: 'Q4 結果' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].stableId).toBe('cal-2330-earnings-20260115');
    expect(out[0].source).toBe('calendar');
    expect(out[0].status).toBe('pending');
    expect(out[0].stocks[0].code).toBe('2330');
  });

  it('does not downgrade existing tracking status', () => {
    const prev = [{
      id: 'cal-2330-earnings-20260115',
      stableId: 'cal-2330-earnings-20260115',
      title: '2330 法說會',
      date: '2026/01/15',
      type: 'earnings',
      source: 'calendar',
      status: 'tracking',
      pred: 'bullish',
      predReason: 'AI 預測',
      actual: null,
      lessons: '',
    }];
    const out = mergeCalendarToNewsEvents(prev, [
      { label: '2330 台積電 法說會', date: '2026/01/15', type: 'earnings', pred: 'neutral' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('tracking'); // not downgraded to pending
  });

  it('preserves user-reviewed pred/predReason', () => {
    const prev = [{
      id: 'cal-2330-earnings-20260115',
      stableId: 'cal-2330-earnings-20260115',
      title: '2330 法說會',
      date: '2026/01/15',
      type: 'earnings',
      source: 'calendar',
      status: 'closed',
      pred: 'bullish',
      predReason: 'I think bullish',
      actual: 'bullish',
      lessons: '驗證成功',
    }];
    const out = mergeCalendarToNewsEvents(prev, [
      { label: '2330 台積電 法說會', date: '2026/01/15', type: 'earnings', pred: 'neutral', predReason: 'AI new guess' },
    ]);
    expect(out[0].pred).toBe('bullish');
    expect(out[0].predReason).toBe('I think bullish');
  });

  it('drops stale pending calendar events not in incoming', () => {
    const prev = [{
      id: 'cal-2330-earnings-20260115',
      stableId: 'cal-2330-earnings-20260115',
      title: 'Old', date: '2026/01/15', type: 'earnings',
      source: 'calendar', status: 'pending',
    }];
    const out = mergeCalendarToNewsEvents(prev, []);
    expect(out).toHaveLength(0);
  });

  it('keeps stale non-pending calendar events not in incoming', () => {
    const prev = [{
      id: 'cal-2330-earnings-20260115',
      stableId: 'cal-2330-earnings-20260115',
      title: 'Old', date: '2026/01/15', type: 'earnings',
      source: 'calendar', status: 'closed',
    }];
    const out = mergeCalendarToNewsEvents(prev, []);
    expect(out).toHaveLength(1);
  });

  it('leaves manual events untouched', () => {
    const prev = [
      { id: 'm1', source: 'manual', title: 'Manual note', status: 'pending' },
    ];
    const out = mergeCalendarToNewsEvents(prev, [
      { label: '2330 法說會', date: '2026/01/15', type: 'earnings' },
    ]);
    expect(out[0]).toEqual(prev[0]); // manual first, untouched
    expect(out).toHaveLength(2);
  });
});
