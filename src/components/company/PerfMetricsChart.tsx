import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface DailyPoint {
  day: string;
  samples: number;
  fcp_p50: number | null;
  fcp_p95: number | null;
  lcp_p50: number | null;
  lcp_p95: number | null;
}

export function PerfDailyChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="day" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}ms`} />
        <Tooltip formatter={(v: number) => `${v} ms`} />
        <Legend />
        <Line type="monotone" dataKey="fcp_p50" name="FCP P50" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="fcp_p95" name="FCP P95" stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="lcp_p50" name="LCP P50" stroke="hsl(var(--mentor))" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="lcp_p95" name="LCP P95" stroke="hsl(var(--mentor))" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
