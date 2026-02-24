import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { people, plans, subscriptions } from '@/data/mockData';
import { PersonRole, SubscriptionStatus } from '@/types';
import { Eye, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

const CompanyAnalysts = () => {
  const analystData = people.map((person) => {
    const personPlans = plans.filter((p) => p.personId === person.id);
    const activeSubs = subscriptions.filter(
      (s) => personPlans.some((p) => p.id === s.planId) && s.status === SubscriptionStatus.ACTIVE
    ).length;
    return { person, planCount: personPlans.length, activeSubs };
  });

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">分析師管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理所有分析師帳號與權限</p>
          </div>
          <Button size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            新增分析師
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">方案數</th>
                  <th className="p-4">活躍訂閱</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {analystData.map(({ person, planCount, activeSubs }) => (
                  <tr key={person.id} className="border-b last:border-0">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={person.avatarUrl || '/placeholder.svg'}
                          alt={person.name}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                        <div>
                          <p className="font-medium text-sm">{person.name}</p>
                          <p className="text-xs text-muted-foreground">{person.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={person.role === PersonRole.ADVISOR ? 'default' : 'secondary'} className="text-xs">
                        {person.role === PersonRole.ADVISOR ? '投顧分析師' : '實戰導師'}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm">{planCount}</td>
                    <td className="p-4 text-sm">{activeSubs || '—'}</td>
                    <td className="p-4">
                      <Badge variant="outline" className="text-xs text-green-600">啟用中</Badge>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/admin/${person.slug}`}>
                          <Eye className="h-4 w-4 mr-1" />
                          查看後台
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyAnalysts;
