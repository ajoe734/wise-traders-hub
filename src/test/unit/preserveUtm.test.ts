import { describe, it, expect } from 'vitest';
import { extractUtm, preserveUtm, utmQueryString, utmCampaignOf } from '@/lib/preserveUtm';

describe('preserveUtm', () => {
  it('只萃取白名單參數', () => {
    expect(extractUtm('?utm_source=ig&utm_campaign=sharkgu&preview=1&token=abc')).toEqual({
      utm_source: 'ig',
      utm_campaign: 'sharkgu',
    });
  });

  it('空 query 回空物件與空字串', () => {
    expect(extractUtm('')).toEqual({});
    expect(extractUtm(null)).toEqual({});
    expect(utmQueryString(undefined)).toBe('');
    expect(preserveUtm('/expert/sharkgu', '')).toBe('/expert/sharkgu');
  });

  it('把 utm 接到目標路徑', () => {
    expect(preserveUtm('/expert/sharkgu', '?utm_source=ig&utm_medium=bio&utm_campaign=x')).toBe(
      '/expert/sharkgu?utm_source=ig&utm_medium=bio&utm_campaign=x',
    );
  });

  it('保留目標 hash 在最後', () => {
    expect(preserveUtm('/expert/sharkgu#plans', '?utm_source=ig')).toBe(
      '/expert/sharkgu?utm_source=ig#plans',
    );
  });

  it('目標已有同名參數時不覆寫', () => {
    expect(preserveUtm('/expert/a?utm_source=direct', '?utm_source=ig')).toBe(
      '/expert/a?utm_source=direct',
    );
  });

  it('目標既有非 utm 參數保留', () => {
    const out = preserveUtm('/checkout/sharkgu/p1?from=profile', '?utm_campaign=aug');
    expect(out).toContain('from=profile');
    expect(out).toContain('utm_campaign=aug');
  });

  it('沒有前導問號也能解析', () => {
    expect(utmQueryString('utm_source=ig&x=1')).toBe('utm_source=ig');
  });

  it('utmCampaignOf', () => {
    expect(utmCampaignOf('?utm_campaign=sharkgu')).toBe('sharkgu');
    expect(utmCampaignOf('?utm_source=ig')).toBeUndefined();
  });

  it('空值參數視為不存在', () => {
    expect(extractUtm('?utm_source=')).toEqual({});
  });
});
