import { describe, it, expect } from 'vitest';
import {
  extractUtm,
  preserveUtm,
  utmQueryString,
  utmCampaignOf,
  shortLinkSlug,
  withShortLinkCampaign,
  landingUtm,
} from '@/lib/preserveUtm';

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

describe('短連結 /s/:slug 自動補 utm_campaign', () => {
  it('代號解析：/s/xxx 取 xxx，其他路徑不取', () => {
    expect(shortLinkSlug('/s/sharkgu')).toBe('sharkgu');
    expect(shortLinkSlug('/s/master-brcto')).toBe('master-brcto');
    expect(shortLinkSlug('/s/sharkgu/')).toBe('sharkgu');
    expect(shortLinkSlug('/expert/sharkgu')).toBeNull();
    expect(shortLinkSlug('/s/')).toBeNull();
    expect(shortLinkSlug('/s/..')).toBeNull();
    expect(shortLinkSlug(null)).toBeNull();
  });

  // 情況 1：網址完全沒有任何 utm → 不補，維持 direct
  it('情況1 完全沒有 utm 時不補（維持 direct）', () => {
    expect(landingUtm('https://legendflow.tw/s/sharkgu')).toEqual({});
    expect(landingUtm('https://legendflow.tw/s/sharkgu?preview=1')).toEqual({});
    expect(preserveUtm('/expert/sharkgu', '', 'sharkgu')).toBe('/expert/sharkgu');
    expect(preserveUtm('/expert/sharkgu', '?preview=1', 'sharkgu')).toBe('/expert/sharkgu');
  });

  // 情況 2：有 utm 但 campaign 空 → 補短連結代號
  it('情況2 有 utm、campaign 空 → 補短連結代號', () => {
    expect(landingUtm('https://legendflow.tw/s/sharkgu?utm_source=ig&utm_medium=social')).toEqual({
      utm_source: 'ig',
      utm_medium: 'social',
      utm_campaign: 'sharkgu',
    });
    expect(landingUtm('https://legendflow.tw/s/master-brcto?utm_source=ig&utm_medium=social')).toEqual({
      utm_source: 'ig',
      utm_medium: 'social',
      utm_campaign: 'master-brcto',
    });
    expect(preserveUtm('/expert/sharkgu', '?utm_source=ig&utm_medium=social', 'sharkgu')).toBe(
      '/expert/sharkgu?utm_source=ig&utm_medium=social&utm_campaign=sharkgu',
    );
  });

  it('情況2b utm_campaign 是空字串也補', () => {
    expect(landingUtm('https://legendflow.tw/s/sharkgu?utm_source=ig&utm_campaign=')).toEqual({
      utm_source: 'ig',
      utm_campaign: 'sharkgu',
    });
  });

  it('情況2c 只有 utm_term 也算有 utm → 補 campaign', () => {
    expect(landingUtm('https://legendflow.tw/s/sharkgu?utm_term=abc')).toEqual({
      utm_term: 'abc',
      utm_campaign: 'sharkgu',
    });
  });

  // 情況 3：已填 campaign → 維持原值
  it('情況3 已填 campaign 維持原值', () => {
    expect(landingUtm('https://legendflow.tw/s/master-brcto?utm_campaign=brcto_journal&utm_content=ig')).toEqual({
      utm_campaign: 'brcto_journal',
      utm_content: 'ig',
    });
    expect(preserveUtm('/expert/master-brcto', '?utm_campaign=brcto_journal', 'master-brcto')).toBe(
      '/expert/master-brcto?utm_campaign=brcto_journal',
    );
  });

  // 情況 4：其他 utm 參數照原樣保留，不新增、不改寫
  it('情況4 其他 utm 原樣保留，不新增不改寫', () => {
    expect(
      landingUtm('https://legendflow.tw/s/sharkgu?utm_source=ig&utm_medium=mia_ig&utm_content=link_in_bio&utm_term=abc'),
    ).toEqual({
      utm_source: 'ig',
      utm_medium: 'mia_ig',
      utm_content: 'link_in_bio',
      utm_term: 'abc',
      utm_campaign: 'sharkgu',
    });
  });

  it('非短連結路徑一律不補', () => {
    expect(landingUtm('https://legendflow.tw/expert/sharkgu?utm_source=ig')).toEqual({ utm_source: 'ig' });
    expect(landingUtm('https://legendflow.tw/holding-checkup?utm_medium=social')).toEqual({ utm_medium: 'social' });
    expect(preserveUtm('/expert/sharkgu', '?utm_source=ig')).toBe('/expert/sharkgu?utm_source=ig');
  });

  it('補值後 hash 仍排在最後', () => {
    expect(preserveUtm('/expert/sharkgu#plans', '?utm_source=ig', 'sharkgu')).toBe(
      '/expert/sharkgu?utm_source=ig&utm_campaign=sharkgu#plans',
    );
  });

  it('withShortLinkCampaign 本身不動其他欄位', () => {
    const src = { utm_source: 'ig' };
    expect(withShortLinkCampaign(src, null)).toBe(src);
    expect(withShortLinkCampaign({}, 'sharkgu')).toEqual({});
    expect(withShortLinkCampaign({ utm_campaign: 'keep' }, 'sharkgu')).toEqual({ utm_campaign: 'keep' });
  });
});
