import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon, Palette, Terminal, ChevronDown, Check } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface ThemeOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  themeStyle: 'default' | 'neobrutalism' | 'hackerterminal';
  theme?: 'light' | 'dark';
  phosphorVariant?: 'green' | 'amber';
}

const OPTIONS: ThemeOption[] = [
  {
    id: 'default-light',
    label: 'Default Light',
    icon: <Sun className="h-4 w-4" />,
    themeStyle: 'default',
    theme: 'light',
  },
  {
    id: 'default-dark',
    label: 'Default Dark',
    icon: <Moon className="h-4 w-4" />,
    themeStyle: 'default',
    theme: 'dark',
  },
  {
    id: 'neobrutalism-light',
    label: 'Neobrutalism Light',
    icon: <Palette className="h-4 w-4 text-pink-500" />,
    themeStyle: 'neobrutalism',
    theme: 'light',
  },
  {
    id: 'neobrutalism-dark',
    label: 'Neobrutalism Dark',
    icon: <Palette className="h-4 w-4 text-pink-500" />,
    themeStyle: 'neobrutalism',
    theme: 'dark',
  },
  {
    id: 'hackerterminal-green',
    label: 'Hacker Terminal (Green)',
    icon: <Terminal className="h-4 w-4 text-green-400" />,
    themeStyle: 'hackerterminal',
    phosphorVariant: 'green',
  },
  {
    id: 'hackerterminal-amber',
    label: 'Hacker Terminal (Amber)',
    icon: <Terminal className="h-4 w-4 text-amber-400" />,
    themeStyle: 'hackerterminal',
    phosphorVariant: 'amber',
  },
];

function getActiveOptionId(
  themeStyle: string,
  theme: string,
  phosphorVariant: string
): string {
  if (themeStyle === 'hackerterminal') {
    return `hackerterminal-${phosphorVariant}`;
  }
  return `${themeStyle}-${theme}`;
}

export function ThemeSelector() {
  const { theme, setTheme, themeStyle, setThemeStyle, phosphorVariant, setPhosphorVariant } = useTheme();
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeId = getActiveOptionId(themeStyle, theme, phosphorVariant);
  const activeOption = OPTIONS.find(o => o.id === activeId) ?? OPTIONS[1];

  // Calculate dropdown position from trigger button
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideTrigger && !insideDropdown) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleSelect(option: ThemeOption) {
    setThemeStyle(option.themeStyle);
    if (option.theme) setTheme(option.theme);
    if (option.phosphorVariant) setPhosphorVariant(option.phosphorVariant);
    setOpen(false);
  }

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm',
          'border-[length:var(--theme-border-width)] border-border',
          'bg-background hover:bg-accent text-foreground transition-colors',
          open && 'bg-accent'
        )}
      >
        {activeOption.icon}
        <span className="hidden md:inline max-w-[120px] truncate">{activeOption.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown rendered in a portal to escape the header's stacking context */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
          className={cn(
            'fixed z-50 min-w-[200px]',
            'rounded-md border-[length:var(--theme-border-width)] border-border',
            'bg-background shadow-md',
            'py-1'
          )}
        >
          {OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => handleSelect(option)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left',
                'hover:bg-accent transition-colors',
                option.id === activeId && 'text-primary'
              )}
            >
              {option.icon}
              <span className="flex-1">{option.label}</span>
              {option.id === activeId && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
