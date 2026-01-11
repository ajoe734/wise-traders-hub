import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: cn(
          "border-border bg-muted text-muted-foreground",
          "dark:bg-white/10 dark:border-white/20 dark:text-white/80"
        ),
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: cn(
          "border-border text-foreground bg-card",
          "dark:border-white/20 dark:bg-white/5"
        ),
        // Role badges - enhanced for dark mode
        advisor: cn(
          "border-border bg-muted text-foreground",
          "dark:bg-advisor/20 dark:border-advisor/30 dark:text-white"
        ),
        "advisor-light": cn(
          "border-border bg-muted text-muted-foreground",
          "dark:bg-advisor/10 dark:border-advisor/20 dark:text-advisor"
        ),
        mentor: cn(
          "border-border bg-muted text-foreground",
          "dark:bg-mentor/20 dark:border-mentor/30 dark:text-white"
        ),
        "mentor-light": cn(
          "border-border bg-muted text-muted-foreground",
          "dark:bg-mentor/10 dark:border-mentor/20 dark:text-mentor"
        ),
        // Status badges - brighter for dark mode
        "success-light": cn(
          "border-success/20 bg-success-light text-success",
          "dark:bg-success/15 dark:border-success/30 dark:text-success"
        ),
        "warning-light": cn(
          "border-warning/20 bg-warning-light text-warning",
          "dark:bg-warning/15 dark:border-warning/30 dark:text-warning"
        ),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
