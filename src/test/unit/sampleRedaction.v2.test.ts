/**
 * M1 v2 鏡像規則（normalize + redaction）測試。
 * 權威仍在 DB；此處鎖住鏡像與 DB 規則的等價行為。
 */
import { describe, it, expect } from 'vitest';
import { normalizeSampleText, redactSampleM1 } from '@/lib/sampleRedaction';

describe('normalizeSampleText', () => {
  it('turns block tags into newlines and strips all tags', () => {
    const out = normalizeSampleText('<p>第一段</p><p></p><p>第二段<br/>第三行</p>');
    expect(out).toBe('第一段\n\n第二段\n第三行');
    expect(out).not.toMatch(/<\/?p>|<br/);
  });

  it('has no leading or trailing blank lines', () => {
    const out = normalizeSampleText('<p>只有一段</p>');
    expect(out).toBe('只有一段');
  });

  it('decodes minimal entities and collapses whitespace', () => {
    expect(normalizeSampleText('<p>A&nbsp;&nbsp;B &amp; C</p>')).toBe('A B & C');
  });
});

describe('redactSampleM1 — html / xss', () => {
  it('fails closed on literal script markup', () => {
    const r = redactSampleM1('<p>操作回顧 &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('html_residual');
    expect(r.text).toBe('');
  });

  it('fails closed on img onerror payload', () => {
    const r = redactSampleM1('<p>回顧 &lt;img src=x onerror=alert(1)&gt;</p>');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('html_residual');
  });

  it('never returns markup in ok text', () => {
    const r = redactSampleM1('<p>本週維持紀律，沒有追高。</p>');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/[<>]/);
  });
});

describe('redactSampleM1 — price masking', () => {
  it('masks thousands-separated amounts whole (no 1,［價格已隱藏］ residue)', () => {
    const r = redactSampleM1('合計最大損失 1,250 美元，約佔本金 10,000 美元的 3%。');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/\d,/);
    expect(r.text).not.toMatch(/\d/);
    expect(r.text).toContain('［價格已隱藏］');
    expect(r.text).toContain('［比例已隱藏］');
  });

  it('masks bare decimals in break/hold context (57.5 / 77.5)', () => {
    const r = redactSampleM1('跌破 57.5 或站上 77.5 皆需重新評估。');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/\d/);
  });

  it('masks strike prices after 履約價 context (950 / 1600)', () => {
    const r = redactSampleM1('若股價逼近任一短履約價（950 或 1600）就先減碼一半。');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/\d/);
  });

  it('masks oil price ranges and 上100', () => {
    const r = redactSampleM1('我自己是看西德州，60~70 市場放心、80~90 做壓力測試，油價上100 就重燃通膨預期。');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/\d/);
  });

  it('does not mask years or plain enumerations', () => {
    const r = redactSampleM1('<p>2026 年的觀察：1.資金面 2.籌碼面 3.情緒面。</p>');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('2026');
    expect(r.text).toContain('1.資金面');
    expect(r.text).not.toContain('［價格已隱藏］');
  });
});

describe('redactSampleM1 — future instruction gate', () => {
  const cases = [
    '並在周五前買好下周準備上攻的標的。',
    '下週進場布局這一檔。',
    '明天加碼。',
    '一定要勇敢地執行反向買進。',
    '建議大家減碼。',
    '請記得停損出場。',
  ];
  for (const c of cases) {
    it(`fails closed: ${c}`, () => {
      const r = redactSampleM1(`<p>${c}</p>`);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('future_instruction');
      expect(r.text).toBe('');
    });
  }

  it('B1 (brcto 權證復盤) fails closed', () => {
    const b1 =
      '<p>我們低檔勇敢進場低接的權證，今天終於得到了明顯的回報，短線上多檔標的獲利已經達到20%以上，因此進行逢高停利，並在周五前買好下周準備上攻的標的。這次的操作也給想做權證的朋友一個非常重要的操作觀念叫做"順大勢、逆小勢"，當你買進的標的因為大盤的利空而出現明顯的回檔，在這個回檔趨勢出現反轉訊號的時候一定要勇敢地執行反向買進，同時也要設定好你的出場目標價，到價的時候果斷執行停利。</p>';
    const r = redactSampleM1(b1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('future_instruction');
  });

  it('retrospective text without instruction stays ok', () => {
    const r = redactSampleM1('<p>因此先獲利了結，轉換標的。</p>');
    expect(r.ok).toBe(true);
  });
});

describe('redactSampleM1 — approved selections stay clean', () => {
  const approved = [
    '第二次進場操作META，我的獲利比第一次還要好，因為我掌握了非常重要的關鍵---相信AI、底部進場。',
    'PLTR這次我成功地抓到了財報利多，財報公布後大漲但隔日沒有繼續攻，因此先獲利了結，轉換標的。',
    '股價自高點修正近五成，下半年營收比上半年好，因此趁還未大幅反彈之際逢低卡位。',
    '「賣方不是賭不動，是賭不會動那麼多。」鐵兀鷹的價值在於把不確定性換成可計算的最大損失。',
  ];
  for (const [i, text] of approved.entries()) {
    it(`selection #${i + 1} has zero residual`, () => {
      const r = redactSampleM1(`<p>${text}</p>`);
      expect(r.ok).toBe(true);
      expect(r.text).not.toMatch(/[<>]/);
      expect(r.text).not.toMatch(/\d[\d,]*(\.\d+)?\s*(元|美元|USD|張|口|股|%)/);
      expect(r.text).not.toMatch(/\d{4,}/);
    });
  }
});
