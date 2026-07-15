import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, MessageCircle, Key, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { avatarUrl } from '@/lib/imageTransform';

interface Props {
  loading: boolean;
  experts: any[];
  subscriberCounts?: Record<string, number>;
  onOpenLine: (exp: any) => void;
  onOpenAccount: (exp: any) => void;
  onToggleStatus: (id: string, currentStatus: string) => void;
  onOpenSubscribers?: (exp: any) => void;
  onAdopt?: (exp: any) => void;
}

export function AnalystsTable({ loading, experts, subscriberCounts = {}, onOpenLine, onOpenAccount, onToggleStatus, onOpenSubscribers, onAdopt }: Props) {

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-muted-foreground">
              <th className="p-4">分析師</th>
              <th className="p-4">角色</th>
              <th className="p-4">Slug</th>
              <th className="p-4">狀態</th>
              <th className="p-4">訂閱人數</th>
              <th className="p-4">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
            ) : experts.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">尚無分析師</td></tr>
            ) : (
              experts.map(exp => (
                <tr key={exp.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <img src={avatarUrl(exp.avatar_url, 64)} alt={exp.name} loading="lazy" decoding="async" className="shrink-0 h-8 w-8 rounded-full object-cover object-[center_15%]" />
                      <p className="font-medium text-sm">{exp.name}</p>
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge variant={exp.role === 'advisor' ? 'default' : 'secondary'} className="text-xs">
                      {exp.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                    </Badge>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">{exp.slug}</td>
                  <td className="p-4">
                    {(() => {
                      const s = exp.status;
                      const cls = s === 'suspended'
                        ? 'bg-red-500 text-white'
                        : s === 'pending'
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-500 text-white';
                      const label = s === 'suspended' ? '已停用' : s === 'pending' ? '待補資料' : '啟用中';
                      return <Badge className={`text-xs ${cls}`}>{label}</Badge>;
                    })()}
                  </td>

                  <td className="p-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onOpenSubscribers?.(exp)}
                      disabled={!onOpenSubscribers}
                    >
                      <Users className="h-3 w-3 mr-1" />
                      {subscriberCounts[exp.id] ?? 0} 人
                    </Button>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenLine(exp)}>
                        <MessageCircle className="h-3 w-3 mr-1" />LINE
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenAccount(exp)}>
                        <Key className="h-3 w-3 mr-1" />帳號
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                        <Link to={`/admin/${exp.slug}`}><Eye className="h-3 w-3 mr-1" />後台</Link>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggleStatus(exp.id, exp.status)}>
                        {exp.status === 'suspended' ? '啟用' : '停用'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </CardContent>
    </Card>
  );
}
