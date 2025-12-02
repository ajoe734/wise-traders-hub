import { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PersonRole } from '@/types';
import { getPersonBySlug } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';
import { Home, Radio, BookOpen, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LineLayoutProps {
  children: ReactNode;
}

export function LineLayout({ children }: LineLayoutProps) {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const location = useLocation();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">找不到此專家</h1>
          <Link to="/experts" className="text-primary underline">返回專家列表</Link>
        </div>
      </div>
    );
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const basePath = `/line/${expertSlug}`;

  const navItems = [
    { path: `${basePath}/home`, icon: Home, label: '首頁' },
    { 
      path: `${basePath}/signals`, 
      icon: Radio, 
      label: isAdvisor ? '即時訊號' : '週報' 
    },
    { path: `${basePath}/teaching`, icon: BookOpen, label: '策略教學' },
    { path: `${basePath}/account`, icon: User, label: '帳號' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <img
              src={expert.avatarUrl || '/placeholder.svg'}
              alt={expert.name}
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="font-semibold">{expert.name}</span>
            <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="text-[10px] px-1.5 py-0">
              {isAdvisor ? '投顧分析師' : '實戰導師'}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 h-full mobile-touch-target",
                isActive(item.path)
                  ? isAdvisor ? "text-advisor" : "text-mentor"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}