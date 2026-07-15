/**
 * HoldingCardFooter — DOM 快照回歸
 *
 * 鎖住 normal/ink × live/screenshot/demo/yclose/null+priceError/null 六種
 * priceSource 分流 + hasToday=false / 負今日損益 / TGT 三情境，共 12 case。
 * 首跑 vitest 會把 markup 寫回 inline snapshot；之後就會 fail-if-diff。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardFooter from '../HoldingCardFooter';

const H_BASE = {
  value: 123456,
  price: 100.5,
  yesterday: 99,
  priceUpdatedAt: '2026-01-01T02:30:00Z',
};

const base = {
  h: H_BASE,
  tp: null,
  upside: null,
  hasToday: true,
  todayPnlNum: 500,
  todayPctNum: 1.23,
  variant: 'normal' as const,
  subColor: '#292520',
  muteColor: '#8A857F',
  hairColor: '#EEEEEE',
  lossColor: '#8A857F',
};

function snap(over: Record<string, unknown> = {}) {
  const { container } = render(<HoldingCardFooter {...base} {...over} />);
  return container.firstChild;
}

describe('HoldingCardFooter — DOM 快照', () => {
  it('#1 normal + live', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(255, 77, 31, 0.133); color: rgb(255, 77, 31); opacity: 0.85; font-weight: 500;"
            title="來源：即時（live）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            即時
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#2 normal + screenshot (muteColor 支)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'screenshot' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(138, 133, 127, 0.094); color: rgb(41, 37, 32); opacity: 0.85; font-weight: 500;"
            title="來源：截圖（screenshot）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            截圖
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#3 normal + demo (lossColor 支)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'demo' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(138, 133, 127, 0.133); color: rgb(41, 37, 32); opacity: 0.85; font-weight: 500;"
            title="來源：DEMO（demo）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            DEMO
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#4 normal + yclose (label=昨收)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'yclose' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(138, 133, 127, 0.133); color: rgb(41, 37, 32); opacity: 0.85; font-weight: 500;"
            title="來源：昨收（yclose）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            昨收
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#5 normal + priceError → errBadge=失敗', () => {
    expect(snap({ h: { ...H_BASE, priceSource: null, priceError: '報價逾時' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; padding: 1px 5px; border-radius: 2px; background: rgba(138, 133, 127, 0.133); color: rgb(138, 133, 127);"
            title="報價逾時"
          >
            失敗
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#6 normal + 無 source 無 error → 無 badge', () => {
    expect(snap({ h: { ...H_BASE, priceSource: null } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });

  it('#7 ink + live', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'live' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 12px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 16px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(255, 77, 31, 0.19); color: rgb(255, 77, 31); opacity: 0.9; font-weight: 500;"
            title="來源：即時（live）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            即時
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#8 ink + screenshot', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'screenshot' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 12px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 16px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(244, 241, 236, 0.1); color: rgba(244, 241, 236, 0.85); opacity: 0.9; font-weight: 500;"
            title="來源：截圖（screenshot）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            截圖
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#9 ink + priceError → ink errBadge', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: null, priceError: '網路錯誤' } })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 12px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 16px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; padding: 1px 5px; border-radius: 2px; background: rgba(244, 241, 236, 0.12); color: rgba(244, 241, 236, 0.65);"
            title="網路錯誤"
          >
            失敗
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });

  it('#10 normal + live + hasToday=false → today=「—」', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' }, hasToday: false, todayPnlNum: null, todayPctNum: null })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(255, 77, 31, 0.133); color: rgb(255, 77, 31); opacity: 0.85; font-weight: 500;"
            title="來源：即時（live）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            即時
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          <span
            style="color: rgb(138, 133, 127);"
          >
            —
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#11 normal + live + 負今日損益（無 + 號）', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' }, todayPnlNum: -800, todayPctNum: -1.23 })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 10px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(255, 77, 31, 0.133); color: rgb(255, 77, 31); opacity: 0.85; font-weight: 500;"
            title="來源：即時（live）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            即時
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          -800
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            -1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
        </span>
      </div>
    `);
  });
  it('#12 ink + live + tp/upside → VALUE 內含 TGT +8.5%', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'live' }, tp: 120, upside: 8.5 })).toMatchInlineSnapshot(`
      <div
        class="wb-bottom"
        style="padding-top: 12px; margin-top: 8px; border-top: 1px solid rgb(238, 238, 238); display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); grid-template-rows: auto auto; column-gap: 16px; row-gap: 2px; align-items: baseline; font-size: 10px; color: rgb(138, 133, 127); font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: 0.06em;"
      >
        <span
          style="grid-column: 1; grid-row: 1; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          TODAY
        </span>
        <span
          style="grid-column: 3; grid-row: 1; display: flex; align-items: center; gap: 6px; font-size: 9px; color: rgb(138, 133, 127); letter-spacing: 0.16em; opacity: 0.7; line-height: 1;"
        >
          <span>
            VALUE
          </span>
          <span
            style="font-size: 8px; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 2px; background: rgba(255, 77, 31, 0.19); color: rgb(255, 77, 31); opacity: 0.9; font-weight: 500;"
            title="來源：即時（live）　更新於 上午02:30　昨收 99.00　現價 100.50"
          >
            即時
          </span>
        </span>
        <div
          style="grid-column: 2; grid-row: 1 / span 2; background: rgb(238, 238, 238); width: 1px; height: 100%;"
        />
        <span
          class="wb-bottom-val"
          style="grid-column: 1; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          +500
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            +
            1.23
            %
          </span>
        </span>
        <span
          class="wb-bottom-val"
          style="grid-column: 3; grid-row: 2; color: rgb(41, 37, 32); font-variant-numeric: tabular-nums; line-height: 1.2;"
        >
          123,456
          <span
            style="margin-left: 6px; color: rgb(138, 133, 127);"
          >
            TGT +8.5%
          </span>
        </span>
      </div>
    `);
  });
});
