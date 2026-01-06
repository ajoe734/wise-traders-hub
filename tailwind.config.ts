import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1400px",
      },
    },
    extend: {
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
        'xl': '32px',
        '2xl': '40px',
        '3xl': '48px',
        '4xl': '64px',
        'section': '48px',
        'card': '24px',
      },
      fontSize: {
        'h1': ['2.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'h2': ['2rem', { lineHeight: '1.25', fontWeight: '600' }],
        'h3': ['1.5rem', { lineHeight: '1.3', fontWeight: '600' }],
        'h4': ['1.25rem', { lineHeight: '1.35', fontWeight: '600' }],
        'h5': ['1.125rem', { lineHeight: '1.4', fontWeight: '600' }],
        'h6': ['1rem', { lineHeight: '1.4', fontWeight: '600' }],
      },
      fontFamily: {
        sans: ["'Noto Sans TC'", "'Inter'", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        cta: {
          DEFAULT: "hsl(var(--cta))",
          hover: "hsl(var(--cta-hover))",
          foreground: "hsl(var(--cta-foreground))",
        },
        // Legacy - mapped to grayscale
        advisor: {
          DEFAULT: "hsl(var(--advisor))",
          dark: "hsl(var(--advisor-dark))",
          light: "hsl(var(--advisor-light))",
          foreground: "hsl(var(--advisor-foreground))",
        },
        mentor: {
          DEFAULT: "hsl(var(--mentor))",
          dark: "hsl(var(--mentor-dark))",
          light: "hsl(var(--mentor-light))",
          foreground: "hsl(var(--mentor-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          light: "hsl(var(--success-light))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          light: "hsl(var(--warning-light))",
        },
        // Signals theme colors (跟單派)
        signals: {
          accent: "hsl(var(--signals-accent))",
          "accent-light": "hsl(var(--signals-accent-light))",
          header: "hsl(var(--signals-header))",
          nav: "hsl(var(--signals-nav))",
          border: "hsl(var(--signals-border))",
        },
        // Learning theme colors (修煉派)
        learning: {
          accent: "hsl(var(--learning-accent))",
          "accent-light": "hsl(var(--learning-accent-light))",
          header: "hsl(var(--learning-header))",
          nav: "hsl(var(--learning-nav))",
          border: "hsl(var(--learning-border))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "gold-glow": {
          "0%, 100%": { 
            boxShadow: "0 0 8px 2px hsla(45, 90%, 55%, 0.4), 0 0 20px 4px hsla(45, 90%, 55%, 0.2)",
          },
          "50%": { 
            boxShadow: "0 0 16px 4px hsla(45, 90%, 60%, 0.6), 0 0 32px 8px hsla(45, 90%, 55%, 0.35)",
          },
        },
        "swipe-hint": {
          "0%, 100%": { 
            transform: "translateX(0) translateZ(0) rotateY(0deg) scale(1)",
          },
          "25%": { 
            transform: "translateX(-8px) translateZ(0) rotateY(-2deg) scale(1)",
          },
          "75%": { 
            transform: "translateX(8px) translateZ(0) rotateY(2deg) scale(1)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "slide-up": "slide-up 0.4s ease-out forwards",
        "gold-glow": "gold-glow 2s ease-in-out infinite",
        "swipe-hint": "swipe-hint 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
