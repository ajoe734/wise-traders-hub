import { describe, it, expect } from 'vitest';
import { renderRichHtml } from '@/components/SafeRichHtml';

// 後台編輯器把老師按 Enter 留的空行存成 <p></p>，編輯器裡看得到空行；
// 會員頁必須同樣保留，否則段落會全部黏在一起。
describe('renderRichHtml 空行與後台編輯器一致', () => {
  it('空段落 <p></p> 保留成可見空行', () => {
    const out = renderRichHtml('<p>一、持股</p><p></p><p>1.華新科</p>');
    expect(out).toBe('<p>一、持股</p><p><br></p><p>1.華新科</p>');
  });

  it('只有空白的段落也保留成空行', () => {
    expect(renderRichHtml('<p>a</p><p>  </p><p>b</p>')).toBe('<p>a</p><p><br></p><p>b</p>');
  });

  it('有內容的段落不變、危險標籤仍被清掉', () => {
    expect(renderRichHtml('<p>a<script>x()</script></p>')).toBe('<p>a</p>');
  });
});
