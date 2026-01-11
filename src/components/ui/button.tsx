import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary - Red CTA
        default: "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        // Secondary - White with gray border, enhanced for dark mode
        secondary: cn(
          "bg-card text-foreground border border-border hover:bg-muted",
          "dark:bg-white/10 dark:border-white/20 dark:hover:bg-white/15"
        ),
        // Ghost - Transparent with black text, enhanced for dark mode
        ghost: cn(
          "text-foreground hover:bg-muted",
          "dark:hover:bg-white/10"
        ),
        // Outline - Same as secondary, enhanced for dark mode
        outline: cn(
          "border border-border bg-card text-foreground hover:bg-muted",
          "dark:bg-transparent dark:border-white/20 dark:hover:bg-white/10"
        ),
        // Destructive
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Link
        link: "text-cta underline-offset-4 hover:underline",
        // Legacy variants mapped to new system
        advisor: "bg-advisor text-advisor-foreground shadow-sm hover:shadow-[0_0_16px_4px_hsla(4,82%,60%,0.5),0_0_32px_8px_hsla(4,82%,55%,0.3)] hover:brightness-110",
        "advisor-outline": cn(
          "border border-border bg-card text-foreground hover:bg-muted",
          "dark:border-advisor/30 dark:text-advisor dark:hover:bg-advisor/10"
        ),
        mentor: "bg-mentor text-mentor-foreground shadow-sm hover:shadow-[0_0_16px_4px_hsla(210,80%,60%,0.5),0_0_32px_8px_hsla(210,80%,55%,0.3)] hover:brightness-110",
        "mentor-outline": cn(
          "border border-border bg-card text-foreground hover:bg-muted",
          "dark:border-mentor/30 dark:text-mentor dark:hover:bg-mentor/10"
        ),
        hero: "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        "hero-advisor": "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        "hero-mentor": "bg-foreground text-background hover:bg-foreground/90 shadow-sm",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        xl: "h-12 rounded-md px-10 text-base",
        icon: "h-10 w-10",
        touch: "h-12 min-w-[44px] px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
