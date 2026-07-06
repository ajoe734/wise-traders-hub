import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { SEOLite as SEO } from '@/components/SEOLite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Database, ExternalLink, ShieldCheck, AlertTriangle, Clock, GitBranch,
  CalendarClock, RefreshCw, CheckCircle2, XCircle, Loader2, AlertOctagon, History,
} from 'lucide-react';
import twsePrimary from '@/checkup/data/twsePrimaryIndustry.json';
import twseSecondary from '@/checkup/data/twseSecondaryIndustry.json';
import stockIndustry from '@/checkup/data/stockIndustry.json';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'on-demand';

type Source = {
  name: string;
  url: string;
  license: string;
  licenseTone: 'safe' | 'caution' | 'restricted';
  freq: string;
  fields: string[];
  usage: string;
  limits: string;
  lastFetchedAt: string | null;
  version: string;
  cadence: Cadence;
  /** 對應 edge function 的 source_key；undefined 代表不支援重抓 */
  refreshKey?: string;
};

type RefreshState = {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  rowCount?: number;
  durationMs?: number;
  finishedAt?: string;
};

type FailureSummary = {
  lastError: string;
  lastErrorAt: string;
  consecutiveFailures: number;
  totalAttempts: number;
  totalErrors: number;
  lastSuccessAt: string | null;
};

const primaryMeta = (twsePrimary as any)._meta || {};
const secondaryMeta = (twseSecondary as any)._meta || {};
const overlayMeta = (stockIndustry as any)._meta || {};

const primaryCount = Object.keys(twsePrimary).filter((k) => !k.startsWith('_')).length;
const secondaryCount = Object.keys(twseSecondary).filter((k) => !k.startsWith('_')).length;
const overlayCount = Object.keys(stockIndustry).filter((k) => !k.startsWith('_')).length;

const SOURCES: Source[] = [
  {
    name: 'TWSE / TPEx ISIN 證券分類',
    url: 'https://isin.twse.com.tw/isin/C_public.jsp?strMode=2',
    license: '政府公開資料，非商業引用',
    licenseTone: 'caution',
    freq: '每交易日',
    fields: ['股票代號', '中文名稱', '主產業別（33 大類）', '市場別', 'ISIN Code'],
    usage: '個股 → 主產業的骨架對照表，作為 twsePrimaryIndustry.json 的來源。',
    limits: 'Big5 編碼；商業再發佈需向 TWSE 申請授權；高頻請求會被暫時封 IP。',
    lastFetchedAt: primaryMeta.generatedAt || null,
    version: `v${(primaryMeta.generatedAt || '').slice(0, 10)} · ${primaryCount.toLocaleString()} 檔`,
    cadence: 'monthly',
    refreshKey: 'twse-isin',
  },
  {
    name: 'TWSE OpenAPI',
    url: 'https://openapi.twse.com.tw/',
    license: '政府公開資料',
    licenseTone: 'caution',
    freq: '每交易日收盤後',
    fields: ['個股基本資料', '每日交易資訊', '產業別', '市場別'],
    usage: '交易所官方 JSON API，作為主產業資料備援與每日交易數據來源。',
    limits: '無明文 rate limit，建議 ≥ 3 秒/次；商用需另洽授權。',
    lastFetchedAt: null,
    version: '即時查詢（無本地快照）',
    cadence: 'daily',
    refreshKey: 'twse-openapi',
  },
  {
    name: 'TPEx OpenAPI',
    url: 'https://www.tpex.org.tw/openapi/',
    license: '政府公開資料',
    licenseTone: 'caution',
    freq: '每交易日',
    fields: ['上櫃個股基本資料', '產業別', '每日行情'],
    usage: '補齊上櫃股票主產業與行情，與 TWSE 相同層級。',
    limits: '同 TWSE；商用需另洽授權。',
    lastFetchedAt: null,
    version: '即時查詢（無本地快照）',
    cadence: 'daily',
    refreshKey: 'tpex-openapi',
  },
  {
    name: 'data.gov.tw 上市/上櫃公司',
    url: 'https://data.gov.tw/dataset/10454',
    license: 'OGDL v1.0（可商用，須標註）',
    licenseTone: 'safe',
    freq: '不定期（約月更）',
    fields: ['公司代號', '名稱', '產業別', '地址', '董事長'],
    usage: '完全可商用的政府開放資料，作為法遵最保險的兜底來源。',
    limits: 'CKAN API 每秒 ≤ 1 次；更新頻率較低。',
    lastFetchedAt: null,
    version: '即時查詢（無本地快照）',
    cadence: 'monthly',
    refreshKey: 'data-gov-tw',
  },
  {
    name: 'FinMind TaiwanStockInfo',
    url: 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo',
    license: 'Apache 2.0（開源）',
    licenseTone: 'safe',
    freq: '每日 01:30',
    fields: ['股票代號', '中文名稱', '次產業別（industry_category）', '市場別（type）'],
    usage: '補 TWSE ISIN 缺漏的次產業欄位，作為 twseSecondaryIndustry.json 的來源。',
    limits: '匿名 low-rate；免費註冊取得 token 為 600 次/天；資料本身仍受原始來源授權約束。',
    lastFetchedAt: secondaryMeta.generatedAt || null,
    version: `v${(secondaryMeta.generatedAt || '').slice(0, 10)} · ${secondaryCount.toLocaleString()} 檔`,
    cadence: 'monthly',
    refreshKey: 'finmind',
  },
  {
    name: '人工校訂覆蓋層 stockIndustry.json',
    url: 'https://github.com/',
    license: '本站自有資料',
    licenseTone: 'safe',
    freq: '每兩週 / 事件驅動',
    fields: ['industries[]（多族群）', 'revenueMix[]（營收比重）', 'themes[]（題材標籤）', 'strategy'],
    usage: '人工校訂的最高優先資料層，補多族群拆分、營收比重與題材（AI / CoWoS / 高股息…）。',
    limits: '人工維護，僅覆蓋 Top 20 熱門持倉與有明確業務拆分的個股。',
    lastFetchedAt: overlayMeta.lastReview ? `${overlayMeta.lastReview}T00:00:00.000Z` : null,
    version: `review ${overlayMeta.lastReview || '—'} · ${overlayCount} 檔覆寫`,
    cadence: 'weekly',
  },
  {
    name: 'MOPS 公開資訊觀測站（產品營收比重 t164sb04）',
    url: 'https://mops.twse.com.tw/mops/web/t164sb04',
    license: '政府公開資料',
    licenseTone: 'caution',
    freq: '每季（季報公告後）',
    fields: ['產品/業務名稱', '營業額', '營收比重（%）', '年度、季別'],
    usage: 'Top 20 熱門持倉的 revenueMix 來源，用來把個股拆進多個產業桶。',
    limits: 'POST 表單、無正式 API；每次抓取間隔 ≥ 3 秒、單次 ≤ 20 檔避免封 IP；只有自願申報公司才有細分（覆蓋率約 40–60%）。',
    lastFetchedAt: null,
    version: 'CLI 隨查隨抓（不進 bundle）',
    cadence: 'quarterly',
  },
  {
    name: 'MOPS 月營收 t05st08',
    url: 'https://mops.twse.com.tw/mops/web/t05st08',
    license: '政府公開資料',
    licenseTone: 'caution',
    freq: '每月 10 日前申報',
    fields: ['月營收', '年增率', '累計營收'],
    usage: '個股月營收時序（未來事件預測 / 營收動能）。',
    limits: '同 t164sb04，需控制頻率；商業再發佈建議引用來源。',
    lastFetchedAt: null,
    version: 'CLI 隨查隨抓（不進 bundle）',
    cadence: 'monthly',
  },
];

const EXCLUDED = [
  { name: 'MoneyDJ', reason: 'TOS 禁止商業爬取' },
  { name: 'Goodinfo 台灣股市', reason: '網頁明確禁止商業使用' },
  { name: '財報狗', reason: 'TOS 禁止未授權爬取' },
  { name: '玩股網 Wantgoo', reason: 'TOS 禁止爬取' },
  { name: 'CMoney', reason: '付費牆 + TOS 嚴格' },
  { name: 'Yahoo Finance TW', reason: 'yfinance 為非官方 API，商用風險高' },
];

const LICENSE_STYLE: Record<Source['licenseTone'], string> = {
  safe: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  caution: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  restricted: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function nextUpdate(iso: string | null, cadence: Cadence): string {
  if (cadence === 'on-demand') return '手動觸發';
  if (!iso) {
    if (cadence === 'daily') return '每交易日更新';
    if (cadence === 'monthly') return '每月月初';
    if (cadence === 'quarterly') return '每季公告後';
    if (cadence === 'weekly') return '每兩週 review';
  }
  const base = new Date(iso!);
  const next = new Date(base);
  switch (cadence) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 14); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
  }
  const overdue = next.getTime() < Date.now();
  return `${fmtDate(next.toISOString()).slice(0, 10)}${overdue ? '（已逾期）' : ''}`;
}

const DataSources = () => {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole('company_admin');
  const [refreshState, setRefreshState] = useState<Record<string, RefreshState>>({});
  const [logs, setLogs] = useState<Record<string, RefreshState>>({});
  const [failures, setFailures] = useState<Record<string, FailureSummary>>({});

  const loadLogs = async () => {
    const keys = SOURCES.map((s) => s.refreshKey).filter(Boolean) as string[];
    const { data } = await supabase
      .from('data_source_refresh_logs')
      .select('source_key,status,row_count,duration_ms,started_at,finished_at,error_message')
      .in('source_key', keys)
      .order('started_at', { ascending: false })
      .limit(300);
    if (!data) return;
    const latest: Record<string, RefreshState> = {};
    const grouped: Record<string, typeof data> = {};
    for (const row of data) {
      (grouped[row.source_key] ||= []).push(row);
      if (latest[row.source_key]) continue;
      latest[row.source_key] = {
        status: (row.status as RefreshState['status']) || 'idle',
        rowCount: row.row_count ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        finishedAt: row.finished_at ?? undefined,
        message: row.error_message ?? undefined,
      };
    }
    const fail: Record<string, FailureSummary> = {};
    for (const [key, rows] of Object.entries(grouped)) {
      const errors = rows.filter((r) => r.status === 'error');
      if (!errors.length) continue;
      // 連續失敗：從最新往回數，遇到 success 就停
      let consecutive = 0;
      for (const r of rows) {
        if (r.status === 'running') continue;
        if (r.status === 'error') consecutive += 1;
        else break;
      }
      const lastSuccess = rows.find((r) => r.status === 'success');
      const lastErr = errors[0];
      fail[key] = {
        lastError: lastErr.error_message || '未知錯誤',
        lastErrorAt: lastErr.finished_at || lastErr.started_at,
        consecutiveFailures: consecutive,
        totalAttempts: rows.filter((r) => r.status !== 'running').length,
        totalErrors: errors.length,
        lastSuccessAt: lastSuccess?.finished_at ?? null,
      };
    }
    setLogs(latest);
    setFailures(fail);
  };

  useEffect(() => {
    if (!user) return;
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const trigger = async (key: string) => {
    setRefreshState((s) => ({ ...s, [key]: { status: 'running' } }));
    try {
      const { data, error } = await supabase.functions.invoke('refresh-data-source', {
        body: { source_key: key },
      });
      if (error) throw new Error(error.message || '呼叫失敗');
      const state: RefreshState = data?.ok
        ? {
            status: 'success',
            rowCount: data.row_count,
            durationMs: data.duration_ms,
            finishedAt: new Date().toISOString(),
          }
        : {
            status: 'error',
            message: data?.error || '未知錯誤',
            durationMs: data?.duration_ms,
            finishedAt: new Date().toISOString(),
          };
      setRefreshState((s) => ({ ...s, [key]: state }));
      setLogs((s) => ({ ...s, [key]: state }));
      loadLogs();
    } catch (e) {
      setRefreshState((s) => ({
        ...s,
        [key]: {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
          finishedAt: new Date().toISOString(),
        },
      }));
      loadLogs();
    }
  };

  return (
    <PortalLayout>
      <SEO
        title="免費外部資料源清單 | legendflow"
        description="本平台持倉族群分類所使用的免費台股資料源：TWSE、TPEx、data.gov.tw、FinMind、MOPS 的欄位、更新頻率、版本與商用授權說明。"
        path="/data-sources"
      />
      <div className="container py-8 md:py-12">
        <div className="mb-10">
          <h1 className="text-2xl md:text-3xl font-bold mb-3">免費外部資料源</h1>
          <p className="text-muted-foreground max-w-3xl">
            持倉族群分類（產業、次產業、營收比重）採用以下公開資料源。每個來源標示最後抓取時間、版本與預計下一次更新。
            {isAdmin && '  管理員可按「立即重新抓取」測試連通性並更新最新筆數紀錄（不會覆蓋 bundle 內快照，仍需 CLI 產出後 commit）。'}
          </p>
        </div>

        <div className="max-w-5xl space-y-4">
          {SOURCES.map((s) => {
            const active = s.refreshKey ? refreshState[s.refreshKey] : undefined;
            const lastLog = s.refreshKey ? logs[s.refreshKey] : undefined;
            const display: RefreshState | undefined = active || lastLog;

            const overdue = (() => {
              if (!s.lastFetchedAt || s.cadence === 'on-demand') return false;
              const nxt = new Date(s.lastFetchedAt);
              switch (s.cadence) {
                case 'daily': nxt.setDate(nxt.getDate() + 1); break;
                case 'weekly': nxt.setDate(nxt.getDate() + 14); break;
                case 'monthly': nxt.setMonth(nxt.getMonth() + 1); break;
                case 'quarterly': nxt.setMonth(nxt.getMonth() + 3); break;
              }
              return nxt.getTime() < Date.now();
            })();

            return (
              <Card key={s.name} className="dark:border-white/10">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Database className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <span>{s.name}</span>
                        <Badge variant="outline" className={LICENSE_STYLE[s.licenseTone]}>
                          {s.license}
                        </Badge>
                        {overdue && (
                          <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20">
                            已逾期
                          </Badge>
                        )}
                      </CardTitle>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2 break-all"
                      >
                        {s.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    {isAdmin && s.refreshKey && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => trigger(s.refreshKey!)}
                        disabled={active?.status === 'running'}
                      >
                        {active?.status === 'running' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span className="ml-1.5">立即重新抓取</span>
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {/* 新鮮度 */}
                  <div className="grid gap-2 md:grid-cols-3 rounded-lg bg-muted/40 p-3">
                    <div className="flex items-start gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">最後抓取（bundle）</div>
                        <div className="font-medium">{fmtDate(s.lastFetchedAt).slice(0, 10)}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <GitBranch className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">版本</div>
                        <div className="font-medium break-all">{s.version}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CalendarClock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">預計下次更新</div>
                        <div className="font-medium">{nextUpdate(s.lastFetchedAt, s.cadence)}</div>
                      </div>
                    </div>
                  </div>

                  {/* 執行結果面板 */}
                  {display && (
                    <div
                      className={`rounded-lg border p-3 text-xs ${
                        display.status === 'running'
                          ? 'border-primary/30 bg-primary/5'
                          : display.status === 'success'
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : display.status === 'error'
                              ? 'border-rose-500/30 bg-rose-500/5'
                              : 'border-muted bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {display.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        {display.status === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                        {display.status === 'error' && <XCircle className="h-4 w-4 text-rose-600" />}
                        <span>
                          {display.status === 'running' && '抓取中…'}
                          {display.status === 'success' && '最近一次抓取成功'}
                          {display.status === 'error' && '最近一次抓取失敗'}
                        </span>
                        {display.finishedAt && display.status !== 'running' && (
                          <span className="text-muted-foreground font-normal">· {fmtDate(display.finishedAt)}</span>
                        )}
                      </div>
                      {display.status === 'success' && (
                        <div className="mt-1 text-muted-foreground">
                          回傳 {display.rowCount?.toLocaleString() ?? '?'} 筆
                          {typeof display.durationMs === 'number' && ` · 耗時 ${(display.durationMs / 1000).toFixed(1)}s`}
                        </div>
                      )}
                      {display.status === 'error' && display.message && (
                        <div className="mt-1 text-rose-700 dark:text-rose-300 break-all">{display.message}</div>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">提供欄位</div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.fields.map((f) => (
                        <Badge key={f} variant="secondary" className="font-normal">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">用途</div>
                      <p className="text-foreground/90">{s.usage}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">來源更新頻率</div>
                      <p className="text-foreground/90">{s.freq}</p>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">使用限制</div>
                    <p className="text-foreground/90">{s.limits}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card className="dark:border-white/10 border-amber-500/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <CardTitle>刻意排除的來源</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-muted-foreground mb-3">
                下列平台雖然常見，但 TOS 明確禁止商業爬取或再發佈，為降低法遵風險本站不採用。若需其資料，請直接向該平台洽談授權。
              </p>
              <ul className="grid gap-2 md:grid-cols-2">
                {EXCLUDED.map((x) => (
                  <li key={x.name} className="flex items-start gap-2">
                    <span className="text-amber-600 dark:text-amber-400 mt-0.5">•</span>
                    <span>
                      <span className="font-medium">{x.name}</span>
                      <span className="text-muted-foreground"> — {x.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="dark:border-white/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>資料合併優先順序</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p className="text-muted-foreground">
                同一檔股票若在多個來源都有資料，會依下列順序合併，高優先者覆蓋低優先者：
              </p>
              <ol className="list-decimal list-inside space-y-1 text-foreground/90">
                <li>使用者「回報分類錯誤」寫入的 override</li>
                <li>人工校訂的 <code className="text-xs bg-muted px-1 py-0.5 rounded">stockIndustry.json</code>（多族群 + revenueMix + themes）</li>
                <li>seedData 內建的手 key 表（demo 兜底）</li>
                <li>TWSE / TPEx ISIN 主產業（單值）</li>
                <li>FinMind 次產業（兜底）</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default DataSources;
