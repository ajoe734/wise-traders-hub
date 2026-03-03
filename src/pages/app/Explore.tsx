import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, ChevronRight, TrendingUp } from "lucide-react";
import { getAllPeopleWithPlans } from "@/data/mockData";
import { PersonRole } from "@/types";
import { supabase } from "@/integrations/supabase/client";

type RoleFilter = "all" | PersonRole.ADVISOR | PersonRole.MENTOR;

const Explore = () => {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [subscribedSlugs, setSubscribedSlugs] = useState<string[]>([]);
  const allExperts = getAllPeopleWithPlans();

  useEffect(() => {
    const fetchSubscribedSlugs = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("member_subscriptions")
        .select("plan_id, expert_plans(expert_id, experts(slug))")
        .eq("user_id", user.id)
        .eq("status", "active");
      if (data) {
        const slugs = data
          .map((sub: any) => sub.expert_plans?.experts?.slug)
          .filter(Boolean) as string[];
        setSubscribedSlugs(slugs);
      }
    };
    fetchSubscribedSlugs();
  }, []);

  const mockPerformance: Record<string, { cumulative: number; annualized: number }> = {};

  const allowedSlugs = ["zhao-pengbo", "zhao-pengbo-mentor", "lin-xiuqi"];
  const filteredExperts = allExperts.filter((expert) => {
    if (!allowedSlugs.includes(expert.slug)) return false;
    if (roleFilter === "all") return true;
    return expert.role === roleFilter;
  });

  const getRoleLabel = (role: PersonRole) => {
    return role === PersonRole.ADVISOR ? "投顧分析師" : "實戰導師";
  };

  const getRoleBadgeVariant = (role: PersonRole) => {
    return role === PersonRole.ADVISOR ? "default" : "secondary";
  };

  return (
    <UnifiedAppLayout>
      <div className="p-4 pb-24 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">探索專家</h1>
          <p className="text-muted-foreground text-sm mt-1">找到適合你的投資專家</p>
        </div>

        {/* Role Filter Tabs */}
        <Tabs value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value={PersonRole.ADVISOR}>投顧分析師</TabsTrigger>
            <TabsTrigger value={PersonRole.MENTOR}>實戰導師</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Expert Cards */}
        <div className="space-y-4">
          {filteredExperts.map((expert) => {
            const isSubscribed = subscribedSlugs.includes(expert.slug);
            const performance = mockPerformance[expert.slug];

            return (
              <Card key={expert.slug} className="overflow-hidden">
                <CardContent className="p-4">
                  {/* Top Row: Avatar + Info */}
                  <div className="flex gap-4">
                    <Avatar className="h-16 w-16 rounded-lg">
                      <AvatarImage src={expert.avatarUrl} alt={expert.name} />
                      <AvatarFallback className="rounded-lg">{expert.name[0]}</AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-lg">{expert.name}</h3>
                        <Badge variant={getRoleBadgeVariant(expert.role)}>
                          {getRoleLabel(expert.role)}
                        </Badge>
                        {isSubscribed && (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            已訂閱
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {expert.bio}
                      </p>
                    </div>
                  </div>

                  {/* Tags */}
                  {expert.styleTags && expert.styleTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {expert.styleTags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Performance Summary */}
                  {performance && (
                    <div className="flex items-center gap-4 mt-4 p-3 bg-muted/50 rounded-lg">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <div className="flex gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">累積</span>
                          <span className={`ml-1 font-medium ${performance.cumulative >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {performance.cumulative >= 0 ? '+' : ''}{performance.cumulative}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">年化</span>
                          <span className={`ml-1 font-medium ${performance.annualized >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {performance.annualized >= 0 ? '+' : ''}{performance.annualized}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-4">
                    <Button asChild variant={isSubscribed ? "default" : "outline"} className="flex-1">
                      <Link to={isSubscribed ? `/app/expert/${expert.slug}` : `/expert/${expert.slug}?from=explore`}>
                        {isSubscribed ? '查看專家詳情' : '查看訂閱方案'}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Empty State */}
        {filteredExperts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">找不到符合條件的老師</p>
          </div>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Explore;
