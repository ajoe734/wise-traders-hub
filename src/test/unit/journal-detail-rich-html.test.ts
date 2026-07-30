import { describe, it, expect } from 'vitest';
import { isRichHtmlEmpty } from '@/pages/app/_journalDetail/richHtml';

describe('isRichHtmlEmpty（週記富文本空判定）', () => {
  it('null / undefined / 空字串視為空', () => {
    expect(isRichHtmlEmpty(null)).toBe(true);
    expect(isRichHtmlEmpty(undefined)).toBe(true);
    expect(isRichHtmlEmpty('')).toBe(true);
  });

  it('只剩空標籤視為空', () => {
    expect(isRichHtmlEmpty('<p></p>')).toBe(true);
    expect(isRichHtmlEmpty('<p>  </p><p><br></p>')).toBe(true);
  });

  it('有文字不算空', () => {
    expect(isRichHtmlEmpty('<p>停損紀律</p>')).toBe(false);
  });

  it('只有媒體（圖／影片／iframe）也不算空', () => {
    expect(isRichHtmlEmpty('<p><img src="chart.png"></p>')).toBe(false);
    expect(isRichHtmlEmpty('<iframe src="x"></iframe>')).toBe(false);
    expect(isRichHtmlEmpty('<video src="x"></video>')).toBe(false);
  });
});
