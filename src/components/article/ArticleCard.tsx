import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { fmtTaipeiDateTime } from '@/lib/articleTime';

export interface ArticleCardData {
  id: string;
  title: string;
  lede: string;
  cover_url: string | null;
  publish_at: string;
  experts?: { name: string } | null;
}

/** 週記牆上的教學文章卡片。 */
export function ArticleCard({ a, to }: { a: ArticleCardData; to: string }) {
  return (
    <Link to={to} className="block">
      <Card className="transition hover:bg-muted/40">
        <CardContent className="flex gap-3 p-4">
          {a.cover_url && (
            <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
              <img src={a.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">教學文章</Badge>
              <span>{a.experts?.name} · {fmtTaipeiDateTime(a.publish_at)}</span>
            </div>
            <div className="mt-1 truncate font-bold text-foreground">{a.title}</div>
            {a.lede && <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.lede}</div>}
          </div>
          <ChevronRight className="h-4 w-4 self-center text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
