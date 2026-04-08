import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        popover: 'hsl(var(--popover))',
        'popover-foreground': 'hsl(var(--popover-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        neon: {
          green: '#39FF14',
          magenta: '#FF00FF',
        },
        sheet: {
          frez: 'hsl(var(--sheet-frez))',
          cut: 'hsl(var(--sheet-cut))',
          steel: 'hsl(var(--sheet-steel))',
          line: 'hsl(var(--sheet-line))'
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      fontFamily: {
        display: [
          'Montserrat',
          'sans-serif'
        ],
        body: [
          'Inter',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          'Oxanium',
          'JetBrains Mono',
          'monospace'
        ],
        logotype: [
          'Montserrat',
          'sans-serif'
        ]
      },
      boxShadow: {
        panel: '0 20px 60px rgba(0, 0, 0, 0.28)',
        'neon-green': '0 0 20px rgba(57, 255, 20, 0.3), 0 0 60px rgba(57, 255, 20, 0.1)',
        'neon-green-sm': '0 0 10px rgba(57, 255, 20, 0.25), 0 0 30px rgba(57, 255, 20, 0.08)',
        'neon-magenta': '0 0 20px rgba(255, 0, 255, 0.3), 0 0 60px rgba(255, 0, 255, 0.1)',
        'neon-magenta-sm': '0 0 10px rgba(255, 0, 255, 0.25), 0 0 30px rgba(255, 0, 255, 0.08)',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)'
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        },
        'neon-pulse': {
          '0%, 100%': {
            opacity: '1',
          },
          '50%': {
            opacity: '0.8',
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'neon-pulse': 'neon-pulse 2s ease-in-out infinite',
      }
    }
  },
  plugins: [],
} satisfies Config;
