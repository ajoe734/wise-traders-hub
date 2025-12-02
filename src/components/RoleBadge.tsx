import { PersonRole } from '@/types';
import { Badge } from '@/components/ui/badge';

interface RoleBadgeProps {
  role: PersonRole;
  size?: 'sm' | 'default' | 'lg';
}

export function RoleBadge({ role, size = 'default' }: RoleBadgeProps) {
  const isAdvisor = role === PersonRole.ADVISOR;
  
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    default: 'text-xs px-2.5 py-0.5',
    lg: 'text-sm px-3 py-1',
  };

  return (
    <Badge 
      variant={isAdvisor ? 'advisor' : 'mentor'}
      className={sizeClasses[size]}
    >
      {isAdvisor ? '投顧分析師' : '實戰導師'}
    </Badge>
  );
}
