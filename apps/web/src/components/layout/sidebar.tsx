'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  FileText,
  FolderKanban,
  LayoutTemplate,
  Settings,
  HelpCircle,
  GitBranch,
} from 'lucide-react';

const navigation = [
  {
    name: 'Projects',
    href: '/projects',
    icon: FolderKanban,
  },
  {
    name: 'Templates',
    href: '/templates',
    icon: LayoutTemplate,
  },
  {
    name: 'Recent Docs',
    href: '/documents',
    icon: FileText,
  },
];

const secondaryNavigation = [
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
  {
    name: 'Help',
    href: '/help',
    icon: HelpCircle,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="glass-sidebar fixed left-0 top-0 z-40 flex h-screen w-64 flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-orange">
          <FileText className="h-4 w-4 text-white" />
        </div>
        <span className="text-lg font-semibold">DocGen.AI</span>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-orange/10 text-brand-orange'
                  : 'text-muted-foreground hover:bg-glass-bg hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Secondary Navigation */}
      <div className="border-t border-glass-border px-3 py-4">
        {secondaryNavigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-orange/10 text-brand-orange'
                  : 'text-muted-foreground hover:bg-glass-bg hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </div>

      {/* Version */}
      <div className="border-t border-glass-border px-6 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          <span>v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}

