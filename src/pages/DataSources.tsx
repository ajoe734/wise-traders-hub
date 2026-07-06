import { PortalLayout } from '@/components/layouts/PortalLayout';
import { SEOLite as SEO } from '@/components/SEOLite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, ExternalLink, ShieldCheck, AlertTriangle } from 'lucide-react';

type Source = {
  name: string;
  url: string;
  license: string;
  licenseTone: 'safe' | 'caution' | 'restricted';
  freq: string;
  fields: string[];
  usage: string;
  limits: string;
};

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

const DataSources = () => {
  return (
    <PortalLayout>
      <SEO
        title="免費外部資料源清單 | legendflow"
        description="本平台持倉族群分類所使用的免費台股資料源：TWSE、TPEx、data.gov.tw、FinMind、MOPS 的欄位、更新頻率與商用授權說明。"
        path="/data-sources"
      />
      <div className="container py-8 md:py-12">
        <div className="mb-10">
          <h1 className="text-2xl md:text-3xl font-bold mb-3">免費外部資料源</h1>
          <p className="text-muted-foreground max-w-3xl">
            持倉族群分類（產業、次產業、營收比重）採用以下公開資料源。每一個來源都列出可取得的欄位、用途、更新頻率與授權限制，方便你與稽核追溯。
          </p>
        </div>

        <div className="max-w-5xl space-y-4">
          {SOURCES.map((s) => (
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
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
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
                    <div className="text-xs font-medium text-muted-foreground mb-1">更新頻率</div>
                    <p className="text-foreground/90">{s.freq}</p>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">使用限制</div>
                  <p className="text-foreground/90">{s.limits}</p>
                </div>
              </CardContent>
            </Card>
          ))}

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
