// Mini sparkline chart for performance quick view
import { EquityPoint } from '@/types/strategy';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

interface SparklineProps {
  data: EquityPoint[];
  className?: string;
  isPositive?: boolean;
}

export function Sparkline({ data, className, isPositive = true }: SparklineProps) {
  // Get last 30 data points for sparkline
  const sparkData = data.slice(-30);
  
  const equities = sparkData.map(d => d.equity);
  const minEquity = Math.min(...equities);
  const maxEquity = Math.max(...equities);
  
  return (
    <div className={cn("h-10 w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sparkData}>
          <YAxis domain={[minEquity * 0.99, maxEquity * 1.01]} hide />
          <Line 
            type="monotone" 
            dataKey="equity" 
            stroke={isPositive ? "hsl(var(--success))" : "hsl(var(--destructive))"}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
