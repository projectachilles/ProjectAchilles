import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CollapsibleSectionProps {
  icon: LucideIcon;
  label: string;
  sectionKey: string;
  itemCount?: number;
  defaultOpen?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  icon: Icon,
  label,
  sectionKey,
  itemCount,
  defaultOpen = false,
  isActive = false,
  children,
}: CollapsibleSectionProps) {
  const storageKey = `achilles-sidebar-${sectionKey}`;
  const [isOpen, setIsOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return stored === 'true';
    return defaultOpen;
  });

  const prevIsActive = useRef(isActive);

  // Auto-expand when isActive transitions to true
  useEffect(() => {
    if (isActive && !prevIsActive.current) {
      setIsOpen(true);
    }
    prevIsActive.current = isActive;
  }, [isActive]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div>
      <button
        onClick={toggle}
        className={`w-full flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground mb-1 py-1 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-60'}`}
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        <Icon className="w-3 h-3" />
        <span className="flex-1 text-left">{label}</span>
        {itemCount != null && (
          <span className="text-[10px] font-normal bg-muted px-1.5 py-0.5 rounded-full">
            {itemCount}
          </span>
        )}
      </button>
      <div
        data-collapsed={!isOpen}
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
