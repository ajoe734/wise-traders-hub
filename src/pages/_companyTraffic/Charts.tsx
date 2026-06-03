/**
 * Lazy-loaded recharts chunk for the company Traffic page.
 * All chart variants live in one module so Vite emits a single dynamic chunk.
 *
 * Color convention here is brand-only (no up/down semantics):
 *   - 訪客 / PV       → --primary
 *   - 營收 / 毛收     → --mentor   (blue, also brand secondary)
 *   - 訂單 / 註冊     → --accent
 *   - drop / 漏失     → --muted-foreground
 */
import {
  ResponsiveContainer,
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Cell, LabelList,
  PieChart, Pie,
  ScatterChart, Scatter, ZAxis,
  LineChart,
} from 'recharts';

const fmtNum = (v: number) => (v || 0).toLocaleString();
const fmtMoney = (v: number) => `NT$${(v || 0).toLocaleString()}`;

function EmptyChart({ height = 200, label = '此區間尚無資料' }: { height?: number; label?: string }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-md"
      style={{ height }}
    >
      {label}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Sparkline (KPI card inset)                                    */
/* ──────────────────────────────────────────────────────────── */
export function Sparkline({
  data, color = 'hsl(var(--primary))', height = 36,
}: { data: number[]; color?: string; height?: number }) {
  const series = data.map((v, i) => ({ i, v: v ?? 0 }));
  if (!series.length) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Daily trend (Overview tab)                                    */
/* ──────────────────────────────────────────────────────────── */
export function DailyTrendChart({
  data,
}: { data: Array<{ day: string; visitors: number; page_views: number; orders: number; gross: number }> }) {
  if (!data || data.length === 0) return <EmptyChart height={320} />;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v}`} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
        <Tooltip
          formatter={(v: number, name: string) => name === '毛收' ? fmtMoney(v) : fmtNum(v)}
          labelClassName="text-foreground"
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="left" dataKey="visitors" name="訪客" fill="hsl(var(--primary))" radius={[3,3,0,0]} barSize={14} />
        <Bar yAxisId="left" dataKey="page_views" name="瀏覽" fill="hsl(var(--primary) / 0.35)" radius={[3,3,0,0]} barSize={14} />
        <Line yAxisId="right" type="monotone" dataKey="orders" name="訂單" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
        <Line yAxisId="right" type="monotone" dataKey="gross" name="毛收" stroke="hsl(var(--mentor))" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Funnel waterfall (horizontal bar)                             */
/* ──────────────────────────────────────────────────────────── */
export function FunnelWaterfall({
  steps, labelMap,
}: {
  steps: Array<{ step: string; visitors: number; drop_from_prev: number | null }>;
  labelMap: Record<string, string>;
}) {
  const start = steps[0]?.visitors || 0;
  const data = steps.map((s, i) => ({
    name: `${i + 1}. ${labelMap[s.step] ?? s.step}`,
    visitors: s.visitors,
    rate: start > 0 ? Math.round((s.visitors / start) * 100) : 0,
    drop: s.drop_from_prev,
  }));
  const height = Math.max(140, data.length * 44);
  if (!data.length) return <EmptyChart height={140} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={150} />
        <Tooltip
          formatter={(v: number, _n, p) => [`${fmtNum(v)} 訪客 · ${p?.payload?.rate}%${p?.payload?.drop != null ? ` · drop ${p.payload.drop}%` : ''}`, '']}
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        />
        <Bar dataKey="visitors" radius={[0, 4, 4, 0]} barSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={`hsl(var(--primary) / ${1 - i * 0.12})`} />
          ))}
          <LabelList dataKey="rate" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Channel donut                                                 */
/* ──────────────────────────────────────────────────────────── */
const DONUT_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--mentor))',
  'hsl(var(--accent))',
  'hsl(var(--primary) / 0.6)',
  'hsl(var(--mentor) / 0.6)',
  'hsl(var(--muted-foreground))',
];
export function ChannelDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`${fmtNum(v)} 訪客`, '']}
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Horizontal bar (events / referrers / landings / instruments)  */
/* ──────────────────────────────────────────────────────────── */
export function HorizontalBar({
  data, valueLabel = '訪客', color = 'hsl(var(--primary))', height,
}: {
  data: Array<{ name: string; value: number }>;
  valueLabel?: string;
  color?: string;
  height?: number;
}) {
  const h = height ?? Math.max(160, data.length * 26 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
        <Tooltip
          formatter={(v: number) => [`${fmtNum(v)} ${valueLabel}`, '']}
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        />
        <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Product stacked bar                                           */
/* ──────────────────────────────────────────────────────────── */
export function ProductStackedBar({
  data,
}: { data: Array<{ product: string; events: number; unique_visitors: number; logged_in_visitors: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="product" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => fmtNum(v)}
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="events" name="事件數" fill="hsl(var(--primary) / 0.4)" radius={[3,3,0,0]} />
        <Bar dataKey="unique_visitors" name="不重複訪客" fill="hsl(var(--primary))" radius={[3,3,0,0]} />
        <Bar dataKey="logged_in_visitors" name="登入會員" fill="hsl(var(--mentor))" radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* ROAS scatter (campaign spend vs revenue)                      */
/* ──────────────────────────────────────────────────────────── */
export function RoasScatter({
  data,
}: { data: Array<{ campaign: string; spend: number; gross: number; orders: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" dataKey="spend" name="花費" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
        <YAxis type="number" dataKey="gross" name="毛收" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
        <ZAxis type="number" dataKey="orders" range={[60, 400]} name="訂單" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
          formatter={(v: number, name: string) => name === '訂單' ? fmtNum(v) : fmtMoney(v)}
          labelFormatter={(_, p) => p?.[0]?.payload?.campaign ?? ''}
        />
        <Scatter data={data} fill="hsl(var(--primary))" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
