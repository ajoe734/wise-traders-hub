/**
 * Gateway registry — 唯一取得對外握手能力的入口。
 *
 * 正式環境走 supabase adapter；測試以 setCheckupGateway() 換成 fake。
 */
import type { CheckupGateway } from './types';
import { createSupabaseGateway } from './supabaseGateway';

let current: CheckupGateway | null = null;

export function getCheckupGateway(): CheckupGateway {
  if (!current) current = createSupabaseGateway();
  return current;
}

export function setCheckupGateway(gateway: CheckupGateway): void {
  current = gateway;
}

export function resetCheckupGateway(): void {
  current = null;
}

export * from './types';
export { createSupabaseGateway } from './supabaseGateway';
export { createFakeGateway } from './fakeGateway';
export type { FakeGateway, FakeGatewayOptions } from './fakeGateway';
