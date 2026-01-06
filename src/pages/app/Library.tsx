import { Link } from 'react-router-dom';
import { LearningLayout } from '@/components/layouts/LearningLayout';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/ui/section-header';
import { FeatureCard } from '@/components/ui/feature-card';
import { 
  Library, 
  Search,
  FileText,
  Video,
  BookMarked,
  Lightbulb,
  Target,
  TrendingUp,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// Content categories
const categories = [
  { id: 'all', label: '全部', count: 60 },
  { id: 'mindset', label: '心法', icon: Lightbulb, count: 12, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { id: 'cases', label: '案例', icon: Target, count: 24, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'framework', label: '框架', icon: TrendingUp, count: 8, color: 'text-learning-accent', bg: 'bg-learning-accent/10' },
  { id: 'review', label: '復盤', icon: FileText, count: 16, color: 'text-purple-500', bg: 'bg-purple-500/10' },
];

// Mock library items
const libraryItems = [
  {
    id: 'lib-1',
    title: '漲停板的10大特徵',
    type: 'article' as const,
    category: 'framework',
    readTime: '5 分鐘',
    isBookmarked: true,
    tags: ['漲停', '特徵', '入門'],
  },
  {
    id: 'lib-2',
    title: '【案例分析】創意(3443) 連續漲停解析',
    type: 'video' as const,
    category: 'cases',
    readTime: '12 分鐘',
    isBookmarked: false,
    tags: ['創意', '案例', 'IC設計'],
  },
  {
    id: 'lib-3',
    title: '當沖心態：如何面對連續虧損',
    type: 'article' as const,
    category: 'mindset',
    readTime: '8 分鐘',
    isBookmarked: true,
    tags: ['心態', '當沖', '風控'],
  },
  {
    id: 'lib-4',
    title: '本週市場復盤 (2025/01/06)',
    type: 'article' as const,
    category: 'review',
    readTime: '10 分鐘',
    isBookmarked: false,
    tags: ['復盤', '市場觀察'],
  },
  {
    id: 'lib-5',
    title: '4有指標判讀技巧',
    type: 'video' as const,
    category: 'framework',
    readTime: '15 分鐘',
    isBookmarked: true,
    tags: ['4有', '指標', '技術分析'],
  },
  {
    id: 'lib-6',
    title: '【案例分析】力積電(6770) 突破型態',
    type: 'video' as const,
    category: 'cases',
    readTime: '10 分鐘',
    isBookmarked: false,
    tags: ['力積電', '突破', '半導體'],
  },
];

export default function LibraryPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = libraryItems.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch = searchQuery === '' || 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const getTypeIcon = (type: 'article' | 'video') => {
    return type === 'video' ? Video : FileText;
  };

  const bookmarkedItems = libraryItems.filter(item => item.isBookmarked);

  return (
    <LearningLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-learning-accent to-learning-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--learning-accent)/0.5)]">
                <Library className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-learning-accent font-semibold tracking-wider uppercase">知識庫</p>
              <h1 className="text-xl font-bold">隨時查閱的學習資源</h1>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="搜尋文章、案例..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 h-12 bg-foreground/[0.03] border-foreground/[0.08] focus:border-learning-accent/50"
          />
        </div>

        {/* Category Tabs - Gaming Style */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {categories.map((category, index) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-all",
                selectedCategory === category.id
                  ? "bg-learning-accent text-white shadow-[0_0_15px_-3px_hsl(var(--learning-accent)/0.5)]"
                  : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.08] border border-foreground/[0.08]"
              )}
            >
              {category.icon && <category.icon className="h-4 w-4" />}
              {category.label}
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full ml-1",
                selectedCategory === category.id ? "bg-white/20" : "bg-foreground/[0.05]"
              )}>
                {category.count}
              </span>
            </button>
          ))}
        </div>

        {/* Bookmarked Section */}
        {selectedCategory === 'all' && bookmarkedItems.length > 0 && (
          <section>
            <SectionHeader
              number="01"
              tag="收藏"
              title="我的收藏"
              icon={<BookMarked className="h-3.5 w-3.5" />}
              theme="learning"
              className="mb-4"
            />
            
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
              {bookmarkedItems.map((item, index) => {
                const TypeIcon = getTypeIcon(item.type);
                return (
                  <FeatureCard 
                    key={item.id} 
                    theme="learning" 
                    className="flex-shrink-0 w-60 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                        item.type === 'video' ? "bg-purple-500/10" : "bg-learning-accent/10"
                      )}>
                        <TypeIcon className={cn(
                          "h-5 w-5",
                          item.type === 'video' ? "text-purple-500" : "text-learning-accent"
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm line-clamp-2">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{item.readTime}</p>
                      </div>
                    </div>
                    {/* Number decoration */}
                    <span className="absolute bottom-2 right-3 text-3xl font-bold opacity-[0.04] text-learning-accent">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </FeatureCard>
                );
              })}
            </div>
          </section>
        )}

        {/* All Items */}
        <section>
          <SectionHeader
            number={selectedCategory === 'all' && bookmarkedItems.length > 0 ? "02" : "01"}
            tag="內容列表"
            title={selectedCategory === 'all' ? '全部內容' : categories.find(c => c.id === selectedCategory)?.label || ''}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            theme="learning"
            className="mb-4"
          />
          <div className="flex items-center justify-end -mt-8 mb-3">
            <span className="text-xs text-muted-foreground">{filteredItems.length} 篇</span>
          </div>
          
          <div className="space-y-2">
            {filteredItems.map((item, index) => {
              const TypeIcon = getTypeIcon(item.type);
              return (
                <FeatureCard key={item.id} theme="learning" className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "relative w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",
                      item.type === 'video' ? "bg-purple-500/10" : "bg-learning-accent/10"
                    )}>
                      <TypeIcon className={cn(
                        "h-5 w-5",
                        item.type === 'video' ? "text-purple-500" : "text-learning-accent"
                      )} />
                      {/* Index number */}
                      <span className="absolute -bottom-1 -right-1 text-xs font-bold text-muted-foreground/50">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs border-0",
                            item.type === 'video' 
                              ? "bg-purple-500/10 text-purple-500" 
                              : "bg-learning-accent/10 text-learning-accent"
                          )}
                        >
                          {item.type === 'video' ? '影片' : '文章'}
                        </Badge>
                        {item.isBookmarked && (
                          <BookMarked className="h-3.5 w-3.5 text-amber-500 drop-shadow-[0_0_4px_hsl(38_92%_50%/0.5)]" />
                        )}
                      </div>
                      <p className="font-medium text-sm line-clamp-1">{item.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">{item.readTime}</span>
                        <div className="flex items-center gap-1">
                          {item.tags.slice(0, 2).map(tag => (
                            <span 
                              key={tag}
                              className="text-xs px-2 py-0.5 rounded-full bg-foreground/[0.05] text-muted-foreground"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </FeatureCard>
              );
            })}
          </div>
        </section>

        {/* Empty State */}
        {filteredItems.length === 0 && (
          <FeatureCard theme="learning" className="p-8 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">找不到符合的內容</p>
            <p className="text-sm text-muted-foreground">試試其他關鍵字或分類</p>
          </FeatureCard>
        )}
      </div>
    </LearningLayout>
  );
}
