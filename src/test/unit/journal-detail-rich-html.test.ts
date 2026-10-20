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

import { learningPointsToParagraphs } from '@/pages/app/_journalDetail/richHtml';

describe('learningPointsToParagraphs（教學重點保留分段）', () => {
  it('<p> 分段保留為兩段', () => {
    expect(learningPointsToParagraphs('<p>一、持股觀察</p><p>二、新入選股</p>')).toEqual(['一、持股觀察', '二、新入選股']);
  });
  it('<br> 換行保留為兩段', () => {
    expect(learningPointsToParagraphs('1.2492華新科<br>2.6830汎銓')).toEqual(['1.2492華新科', '2.6830汎銓']);
  });
  it('純文字換行保留為兩段', () => {
    expect(learningPointsToParagraphs('停損紀律\n資金控管')).toEqual(['停損紀律', '資金控管']);
  });
  it('<li> 各自成段、空段丟棄', () => {
    expect(learningPointsToParagraphs('<ul><li>A</li><li>B</li></ul><p></p>')).toEqual(['A', 'B']);
  });
});
