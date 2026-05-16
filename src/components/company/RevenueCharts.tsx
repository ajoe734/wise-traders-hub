/**
 * Lazy-loaded recharts chunk for the company Revenue page.
 *
 * Why this file exists:
 * - `Revenue.tsx` previously imported `recharts` directly, which pulled the
 *   `vendor-recharts` chunk (≈107 KB gz) into the company entry. The page is
 *   admin-only and most sessions never open the chart tabs.
 * - All three chart components live here so they share a single dynamic
 *   chunk; `React.lazy` consumers in `Revenue.tsx` each pull a named export
 *   from this same module → Vite dedupes into one network roundtrip.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";

const fmtMoney = (v: number) => `NT$${(v || 0).toLocaleString()}`;

export function MonthTrendChart({ data }: { data: Array<{ month: string; gross: number; platform: number; expert: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <Tooltip formatter={(v: number) => fmtMoney(v)} />
        <Line type="monotone" dataKey="gross" name="毛收" stroke="hsl(var(--company))" strokeWidth={2} />
        <Line type="monotone" dataKey="platform" name="平台" stroke="hsl(var(--primary))" strokeWidth={2} />
        <Line type="monotone" dataKey="expert" name="專家" stroke="hsl(var(--mentor))" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SourceBreakdownChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={70} />
        <Tooltip formatter={(v: number) => fmtMoney(v)} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
          {data.map((_, i) => (
            <Cell key={i} fill="hsl(var(--company))" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CheckupTrendChart({ data }: { data: Array<{ month: string; gross: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => fmtMoney(v)} />
        <Line type="monotone" dataKey="gross" name="毛收" stroke="hsl(var(--company))" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
