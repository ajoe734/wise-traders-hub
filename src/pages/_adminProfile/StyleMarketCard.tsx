import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';

interface Props {
  styleTags: string[];
  markets: string[];
  newTag: string;
  newMarket: string;
  isReadOnly: boolean;
  setStyleTags: (v: string[]) => void;
  setMarkets: (v: string[]) => void;
  setNewTag: (v: string) => void;
  setNewMarket: (v: string) => void;
}

export default function StyleMarketCard({
  styleTags, markets, newTag, newMarket, isReadOnly,
  setStyleTags, setMarkets, setNewTag, setNewMarket,
}: Props) {
  const addTag = () => {
    if (newTag.trim() && !styleTags.includes(newTag.trim())) {
      setStyleTags([...styleTags, newTag.trim()]);
      setNewTag('');
    }
  };
  const addMarket = () => {
    if (newMarket.trim() && !markets.includes(newMarket.trim())) {
      setMarkets([...markets, newMarket.trim()]);
      setNewMarket('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">風格與市場</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>風格標籤</Label>
          <div className="flex flex-wrap gap-2">
            {styleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <PermissionTooltip disabled={isReadOnly}>
                  <X
                    className={cn('h-3 w-3', isReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}
                    onClick={() => !isReadOnly && setStyleTags(styleTags.filter(t => t !== tag))}
                  />
                </PermissionTooltip>
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                placeholder="新標籤"
                className={cn('h-6 w-24 text-xs', isReadOnly && 'bg-muted/50 cursor-not-allowed')}
                onKeyDown={e => e.key === 'Enter' && !isReadOnly && addTag()}
                readOnly={isReadOnly}
              />
              <PermissionTooltip disabled={isReadOnly}>
                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addTag} disabled={isReadOnly}>
                  <Plus className="h-3 w-3" />
                </Button>
              </PermissionTooltip>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label>交易市場</Label>
          <div className="flex flex-wrap gap-2">
            {markets.map((market) => (
              <Badge key={market} variant="outline" className="gap-1">
                {market}
                <PermissionTooltip disabled={isReadOnly}>
                  <X
                    className={cn('h-3 w-3', isReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}
                    onClick={() => !isReadOnly && setMarkets(markets.filter(m => m !== market))}
                  />
                </PermissionTooltip>
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                value={newMarket}
                onChange={e => setNewMarket(e.target.value)}
                placeholder="新市場"
                className={cn('h-6 w-24 text-xs', isReadOnly && 'bg-muted/50 cursor-not-allowed')}
                onKeyDown={e => e.key === 'Enter' && !isReadOnly && addMarket()}
                readOnly={isReadOnly}
              />
              <PermissionTooltip disabled={isReadOnly}>
                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addMarket} disabled={isReadOnly}>
                  <Plus className="h-3 w-3" />
                </Button>
              </PermissionTooltip>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
