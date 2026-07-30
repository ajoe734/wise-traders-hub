/**
 * Checkup Gateway — 持倉看板所有「對外握手」的唯一接縫。
 *
 * 介面刻意很小（http / db / auth / invoke / realtime 五個成員），
 * 但背後藏了不少實作：錯誤正規化、JSON 解析、線上偵測、
 * realtime channel 生命週期管理、auth 訂閱退訂。
 *
 * 契約：
 *  1. `src/checkup/hooks/**` 一律不得直接 `fetch()` 或 import supabase client，
 *     必須透過 `getCheckupGateway()` 取得此介面。
 *  2. 失敗時一律丟 `CheckupGatewayError`（帶 status / url / body），
 *     呼叫端不需要各自處理 `res.ok`。
 *  3. 訂閱類 API（auth / realtime）一律回傳「退訂函式」，不外露 channel 物件。
 */

export class CheckupGatewayError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(message: string, opts: { status?: number; url?: string; body?: string } = {}) {
    super(message);
    this.name = 'CheckupGatewayError';
    this.status = opts.status ?? 0;
    this.url = opts.url ?? '';
    this.body = opts.body ?? '';
  }
}

export interface GatewayHttp {
  /** 發請求並解析 JSON；非 2xx 或 JSON 解析失敗一律丟 CheckupGatewayError。 */
  json<T = any>(url: string, init?: RequestInit): Promise<T>;
  /** 同 json()，但任何失敗都回 null（用於「拿不到就算了」的背景預載）。 */
  tryJson<T = any>(url: string, init?: RequestInit): Promise<T | null>;
  /** 純文字回應（TWSE 等非 JSON 端點）。 */
  text(url: string, init?: RequestInit): Promise<string>;
  /** 二進位回應（分享圖匯出的 dataURL → Blob）。 */
  blob(url: string, init?: RequestInit): Promise<Blob>;
}

export interface GatewayAuth {
  /** 目前登入者 id；未登入或取不到回 null（不丟錯）。 */
  getUserId(): Promise<string | null>;
  /** 訂閱登入狀態變化，回傳退訂函式。 */
  onAuthStateChange(handler: (userId: string | null) => void): () => void;
  /** 目前 session 的 access token；沒有回 null。 */
  getAccessToken(): Promise<string | null>;
}

export interface RealtimeSpec {
  /** channel 名稱（需全域唯一）。 */
  name: string;
  table: string;
  schema?: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  filter?: string;
}

export interface GatewayRealtime {
  /** 訂閱一張表的變更，回傳退訂函式（內部負責 removeChannel）。 */
  subscribe(spec: RealtimeSpec, handler: (payload: any) => void): () => void;
}

export interface GatewayDb {
  /** supabase query builder 直通；查詢語法留在呼叫端，連線交給 gateway。 */
  from(table: string): any;
}

export interface CheckupGateway {
  http: GatewayHttp;
  db: GatewayDb;
  auth: GatewayAuth;
  realtime: GatewayRealtime;
  /** 呼叫 Edge Function；error 一律轉成 CheckupGatewayError。 */
  invoke<T = any>(name: string, body?: unknown): Promise<T>;
  /** Edge Functions 的 base URL（少數需要自組 URL 直連的場景）。 */
  functionsUrl(): string;
}
