import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

const themes = [
  { value: 'light', label: '淺色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '系統', icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex gap-2">
        {themes.map((t) => (
          <Button key={t.value} variant="outline" size="sm" disabled>
            <t.icon className="h-4 w-4 mr-1" />
            {t.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {themes.map((t) => (
        <Button
          key={t.value}
          variant={theme === t.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTheme(t.value)}
        >
          <t.icon className="h-4 w-4 mr-1" />
          {t.label}
        </Button>
      ))}
    </div>
  );
}
