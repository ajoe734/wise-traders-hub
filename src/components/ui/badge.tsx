import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: "border-border bg-muted text-muted-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground bg-card",
        // Role badges - now grayscale
        advisor: "border-border bg-muted text-foreground",
        "advisor-light": "border-border bg-muted text-muted-foreground",
        mentor: "border-border bg-muted text-foreground",
        "mentor-light": "border-border bg-muted text-muted-foreground",
        // Status badges
        "success-light": "border-success/20 bg-success-light text-success",
        "warning-light": "border-warning/20 bg-warning-light text-warning",
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
