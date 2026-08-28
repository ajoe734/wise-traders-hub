/**
 * useExpectedTradeDate — `expectedTradeDateStore` 的薄封裝（單一 scheduler 的訂閱端）。
 * 元件只拿 snapshot，不自己算「現在幾點」。
 */
import { useSyncExternalStore } from 'react';
import {
  getExpectedSnapshot,
  subscribeExpected,
  type ExpectedSnapshot,
} from '@/checkup/lib/expectedTradeDateStore';

export function useExpectedTradeDate(): ExpectedSnapshot {
  return useSyncExternalStore(subscribeExpected, getExpectedSnapshot, getExpectedSnapshot);
}

export default useExpectedTradeDate;
