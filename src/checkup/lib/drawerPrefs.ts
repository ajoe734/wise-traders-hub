/**
 * drawerPrefs — 持倉抽屜的偏好設定（C5）
 *
 * 抽屜 UI 只認識兩個 store，不再自己碰 localStorage。
 * schema 變更時改 version（並視需要提供 migrate），不用再擔心壞資料把抽屜炸掉。
 */
import { createPrefsStore } from './prefsStore';

export type HoldingPanelPrefs = {
  showThesis: boolean;
  showNextEvent: boolean;
  showRange: boolean;
  showCost: boolean;
  showTargetBar: boolean;
  showCharts: boolean;
};

export const DEFAULT_PREFS: HoldingPanelPrefs = {
  showThesis: true,
  showNextEvent: true,
  showRange: true,
  showCost: true,
  showTargetBar: true,
  showCharts: true,
};

export const holdingPanelPrefs = createPrefsStore<HoldingPanelPrefs>({
  key: 'holdingPanel.prefs.v1',
  defaults: DEFAULT_PREFS,
  sanitize: (v) =>
    Object.fromEntries(
      Object.keys(DEFAULT_PREFS).map((k) => [k, !!v[k as keyof HoldingPanelPrefs]]),
    ) as HoldingPanelPrefs,
});

export type HoldingExportPrefs = {
  format: 'png' | 'jpeg' | 'pdf';
  ratio: 'square' | 'story' | 'wide';
  resolution: 'std' | 'high' | 'print';
};

export const DEFAULT_EXPORT_PREFS: HoldingExportPrefs = {
  format: 'png',
  ratio: 'square',
  resolution: 'high',
};

const FORMATS = ['png', 'jpeg', 'pdf'] as const;
const RATIOS = ['square', 'story', 'wide'] as const;
const RESOLUTIONS = ['std', 'high', 'print'] as const;

export const holdingExportPrefs = createPrefsStore<HoldingExportPrefs>({
  key: 'holdingPanel.export.v1',
  defaults: DEFAULT_EXPORT_PREFS,
  sanitize: (v) => ({
    format: (FORMATS as readonly string[]).includes(v.format) ? v.format : DEFAULT_EXPORT_PREFS.format,
    ratio: (RATIOS as readonly string[]).includes(v.ratio) ? v.ratio : DEFAULT_EXPORT_PREFS.ratio,
    resolution: (RESOLUTIONS as readonly string[]).includes(v.resolution)
      ? v.resolution
      : DEFAULT_EXPORT_PREFS.resolution,
  }),
});


/** 關鍵分點視窗（1／5／10 日）。抽屜關掉再開會沿用上次選擇。 */
export type BsrWindowKey = 'd1' | 'd5' | 'd10';
export type ChipsPrefs = { bsrWindow: BsrWindowKey };

export const DEFAULT_CHIPS_PREFS: ChipsPrefs = { bsrWindow: 'd5' };

const BSR_WINDOWS = ['d1', 'd5', 'd10'] as const;

export const chipsPrefs = createPrefsStore<ChipsPrefs>({
  key: 'holdingPanel.chips.v1',
  defaults: DEFAULT_CHIPS_PREFS,
  sanitize: (v) => ({
    bsrWindow: (BSR_WINDOWS as readonly string[]).includes(v.bsrWindow as string)
      ? (v.bsrWindow as BsrWindowKey)
      : DEFAULT_CHIPS_PREFS.bsrWindow,
  }),
});
