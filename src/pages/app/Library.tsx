import { Link } from 'react-router-dom';
import { LearningLayout } from '@/components/layouts/LearningLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  Tag
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// Content categories
const categories = [
  { id: 'all', label: '全部', count: 60 },
  { id: 'mindset', label: '心法', icon: Lightbulb, count: 12 },
  { id: 'cases', label: '案例', icon: Target, count: 24 },
  { id: 'framework', label: '框架', icon: TrendingUp, count: 8 },
  { id: 'review', label: '復盤', icon: FileText, count: 16 },
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

  return (
    <LearningLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Library className="h-5 w-5 text-learning-accent" />
              知識庫
            </h1>
            <p className="text-sm text-muted-foreground mt-1">隨時查閱的學習資源</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="搜尋文章、案例..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                selectedCategory === category.id
                  ? "bg-learning-accent text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {category.icon && <category.icon className="h-3.5 w-3.5" />}
              {category.label}
              <span className="text-xs opacity-70">({category.count})</span>
            </button>
          ))}
        </div>

        {/* Bookmarked Section */}
        {selectedCategory === 'all' && (
          <section className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <BookMarked className="h-4 w-4 text-learning-accent" />
              我的收藏
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
              {libraryItems.filter(item => item.isBookmarked).map(item => {
                const TypeIcon = getTypeIcon(item.type);
                return (
                  <Card key={item.id} className="flex-shrink-0 w-56 hover:bg-accent/50 transition-colors cursor-pointer">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 rounded-lg bg-learning-accent/10 flex items-center justify-center flex-shrink-0">
                          <TypeIcon className="h-4 w-4 text-learning-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-2">{item.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{item.readTime}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* All Items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              {selectedCategory === 'all' ? '全部內容' : categories.find(c => c.id === selectedCategory)?.label}
            </h2>
            <span className="text-xs text-muted-foreground">{filteredItems.length} 篇</span>
          </div>
          
          <div className="space-y-2">
            {filteredItems.map(item => {
              const TypeIcon = getTypeIcon(item.type);
              return (
                <Card key={item.id} className="hover:bg-accent/50 transition-colors cursor-pointer">
                  <CardContent className="p-4">
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
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {item.type === 'video' ? '影片' : '文章'}
                          </Badge>
                          {item.isBookmarked && (
                            <BookMarked className="h-3 w-3 text-amber-500" />
                          )}
                        </div>
                        <p className="font-medium text-sm line-clamp-1">{item.title}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">{item.readTime}</span>
                          <div className="flex items-center gap-1">
                            {item.tags.slice(0, 2).map(tag => (
                              <span 
                                key={tag}
                                className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Empty State */}
        {filteredItems.length === 0 && (
          <Card className="bg-muted/30 p-8 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">找不到符合的內容</p>
            <p className="text-sm text-muted-foreground">試試其他關鍵字或分類</p>
          </Card>
        )}
      </div>
    </LearningLayout>
  );
}
