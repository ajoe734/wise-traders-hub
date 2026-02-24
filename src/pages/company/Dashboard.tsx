import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, DollarSign, Radio, TrendingUp, ArrowUpRight } from 'lucide-react';
import { people } from '@/data/mockData';

const CompanyDashboard = () => {
  const stats = [
    { label: '總分析師數', value: people.length, change: '+1 本月', icon: Users },
    { label: '總活躍訂閱者', value: 156, change: '+12', icon: Users },
    { label: '本月平台營收', value: 'NT$458,000', change: '+18%', icon: DollarSign },
    { label: '本月總訊號數', value: 34, change: '+8', icon: Radio },
  ];

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">公司總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">全平台營運數據一覽</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs mt-1 flex items-center gap-1 text-green-600 dark:text-green-400">
                  <ArrowUpRight className="h-3 w-3" />
                  {stat.change}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Analysts Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分析師概況</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {people.map((person) => (
                <div key={person.id} className="flex items-center justify-between py-2 border-b last:border-0">
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {person.role === 'ADVISOR' ? '投顧分析師' : '實戰導師'}
                    </Badge>
                    <a
                      href={`/admin/${person.slug}`}
                      className="text-xs text-primary hover:underline"
                    >
                      查看後台 →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyDashboard;
