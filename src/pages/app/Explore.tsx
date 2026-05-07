import { useState } from "react";
import { Link } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { ExpertRole } from "@/types";
import { useExperts } from "@/hooks/useExpert";
import { useSubscribedExpertSlugs } from "@/hooks/useSubscriptions";
import { avatarUrl } from "@/lib/imageTransform";

type RoleFilter = "all" | "advisor" | "mentor";

const Explore = () => {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const { data: allExperts = [], isLoading } = useExperts();
  const { data: subscribedSlugs = [] } = useSubscribedExpertSlugs();

  const filteredExperts = allExperts.filter((expert) => {
    if (roleFilter === "all") return true;
    return expert.role === roleFilter;
  });

  const getRoleLabel = (role: ExpertRole) => role === 'advisor' ? "投顧分析師" : "實戰導師";
  const getRoleBadgeVariant = (role: ExpertRole) => role === 'advisor' ? "default" as const : "secondary" as const;

  return (
    <UnifiedAppLayout>
      <div className="p-4 pb-24 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">探索專家</h1>
          <p className="text-muted-foreground text-sm mt-1">找到適合你的投資專家</p>
        </div>

        <Tabs value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="advisor">投顧分析師</TabsTrigger>
            <TabsTrigger value="mentor">實戰導師</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            {filteredExperts.map((expert) => {
              const isSubscribed = subscribedSlugs.includes(expert.slug);
              return (
                <Card key={expert.slug} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      <Avatar className="h-16 w-16 rounded-lg">
                        <AvatarImage src={expert.avatarUrl} alt={expert.name} />
                        <AvatarFallback className="rounded-lg">{expert.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{expert.name}</h3>
                          <Badge variant={getRoleBadgeVariant(expert.role)}>{getRoleLabel(expert.role)}</Badge>
                          {isSubscribed && (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <Check className="h-3 w-3 mr-1" />已訂閱
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{expert.bio}</p>
                      </div>
                    </div>
                    {expert.styleTags && expert.styleTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {expert.styleTags.slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-4">
                      {isSubscribed ? (
                        <Button asChild className={`flex-1 ${expert.role === 'advisor' ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90'} text-white`}>
                          <Link to={`/app/expert/${expert.slug}`}>查看專家詳情<ChevronRight className="h-4 w-4 ml-1" /></Link>
                        </Button>
                      ) : (
                        <Button asChild variant="outline" className="flex-1">
                          <Link to={`/expert/${expert.slug}?from=explore`}>查看訂閱方案<ChevronRight className="h-4 w-4 ml-1" /></Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {!isLoading && filteredExperts.length === 0 && (
          <div className="text-center py-12"><p className="text-muted-foreground">找不到符合條件的老師</p></div>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Explore;
