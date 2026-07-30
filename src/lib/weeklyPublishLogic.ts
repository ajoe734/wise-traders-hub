/**
 * Weekly journal publish logic helpers.
 *
 * 實作已收斂到 LINE 推播文案核心：唯一資料源
 * `supabase/functions/_shared/linePushCore.ts`，前台鏡像 `@/lib/linePushCore`
 * （由 `scripts/gen-line-push-core-mirror.mjs` 產生）。
 *
 * 本檔只保留既有呼叫端（integration 測試等）的相容出口，不得再放實作。
 */

export {
  buildPromoMessage,
  classifyLineTargets,
  htmlToText,
  plainifySignal,
} from '@/lib/linePushCore';

export type {
  ExpertPerformance,
  LineBinding,
  ActiveSubscription,
} from '@/lib/linePushCore';
