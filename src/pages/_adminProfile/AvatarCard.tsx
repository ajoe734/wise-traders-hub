import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { avatarUrl } from '@/lib/imageTransform';

interface Props {
  expert: any;
  isReadOnly: boolean;
  uploading: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function AvatarCard({ expert, isReadOnly, uploading, onPick }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">頭像</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <img
            src={avatarUrl(expert.avatar_url, 160)}
            alt={expert.name}
            loading="lazy"
            decoding="async"
            className="shrink-0 h-20 w-20 rounded-full object-cover object-[center_15%] border-2 border-border"
          />
          <div>
            <PermissionTooltip disabled={isReadOnly}>
              <label className={cn(isReadOnly && 'pointer-events-none')}>
                <Button variant="outline" size="sm" asChild disabled={uploading || isReadOnly}>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading ? '上傳中...' : '更換頭像'}
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPick}
                  disabled={isReadOnly}
                />
              </label>
            </PermissionTooltip>
            <p className="text-xs text-muted-foreground mt-2">建議尺寸 400x400px，JPG 或 PNG</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
