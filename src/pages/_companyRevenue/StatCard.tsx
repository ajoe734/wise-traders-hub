import { Card, CardContent } from '@/components/ui/card';

export function StatCard({
  label, value, hint, variant,
}: { label: string; value: string; hint?: string; variant?: 'primary' | 'destructive' }) {
  const valueClass =
    variant === 'destructive' ? 'text-destructive' :
    variant === 'primary' ? 'text-primary' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
