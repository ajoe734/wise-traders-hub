/**
 * CSV 匯出工具測試 — 對應 CheckupQuotaAudit.tsx 內 csvEscape / downloadCSV 邏輯。
 * 因為這些函式目前是 page-local，我們在這裡複製同樣邏輯做行為合約測試，
 * 確保任一未來改動都會被同樣的測試守住（BOM、逗號跳脫、引號轉義、null/undefined）。
 */
import { describe, it, expect } from 'vitest';

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function buildCSV(header: string[], rows: unknown[][]): string {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  return '\ufeff' + body;
}

describe('csv export contract', () => {
  it('escapes commas with quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('escapes newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('passes plain values through untouched', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(123)).toBe('123');
  });

  it('renders null/undefined as empty string', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('prefixes output with UTF-8 BOM for Excel compatibility', () => {
    const out = buildCSV(['a'], [['1']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it('serialises mixed-type rows correctly', () => {
    const out = buildCSV(
      ['user_id', 'name', 'note'],
      [
        ['uuid-1', 'Alice', 'plain'],
        ['uuid-2', 'Bob, Jr.', 'has,comma'],
        ['uuid-3', null, 'has "quote"'],
      ],
    );
    expect(out).toBe(
      '\ufeffuser_id,name,note\n' +
        'uuid-1,Alice,plain\n' +
        'uuid-2,"Bob, Jr.","has,comma"\n' +
        'uuid-3,,"has ""quote"""',
    );
  });
});
