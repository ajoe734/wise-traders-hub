export const ChartFallback = ({ height = 260 }: { height?: number }) => (
  <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
    載入圖表…
  </div>
);
