import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAnalyticsAuth } from "@/hooks/useAnalyticsAuth";
import { useCanAccessModule, useHasPermission } from "@/hooks/useAppRole";
import {
  Shield,
  BarChart3,
  Monitor,
  Home,
  Bookmark,
  Settings,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Cpu,
  Package,
  Activity,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface AppSidebarProps {
  collapsed: boolean;
}

interface NavItem {
  label: string;
  icon: typeof Shield;
  path: string;
  locked?: boolean;
}

interface ModuleWithItems extends NavItem {
  subItems: NavItem[];
}

export function AppSidebar({ collapsed }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const canAccessEndpoints = useCanAccessModule("endpoints");
  const canAccessSettings = useCanAccessModule("settings");
  const canAccessAgents = useHasPermission("endpoints:agents:read");

  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(["/dashboard", "/analytics", "/endpoints"]),
  );

  // Flyout panel for collapsed sidebar
  const [flyoutModule, setFlyoutModule] = useState<ModuleWithItems | null>(null);
  const [flyoutY, setFlyoutY] = useState(0);
  const flyoutTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openFlyout = (module: ModuleWithItems, e: React.MouseEvent) => {
    if (module.locked) return;
    if (flyoutTimeout.current) clearTimeout(flyoutTimeout.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFlyoutY(rect.top);
    setFlyoutModule(module);
  };

  const closeFlyout = () => {
    flyoutTimeout.current = setTimeout(() => setFlyoutModule(null), 120);
  };

  const keepFlyout = () => {
    if (flyoutTimeout.current) clearTimeout(flyoutTimeout.current);
  };

  const modules: ModuleWithItems[] = [
    {
      label: "Tests",
      icon: Shield,
      path: "/dashboard",
      subItems: [
        { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
        { label: "Browse All", icon: Home, path: "/dashboard?tab=browse" },
        { label: "Favorites", icon: Bookmark, path: "/favorites" },
      ],
    },
    {
      label: "Analytics",
      icon: BarChart3,
      path: "/analytics",
      locked: !analyticsConfigured,
      subItems: [
        { label: "Dashboard", icon: LayoutDashboard, path: "/analytics" },
        {
          label: "Executions",
          icon: Activity,
          path: "/analytics?tab=executions",
        },
      ],
    },
    ...(canAccessEndpoints
      ? [
          {
            label: "Endpoints",
            icon: Monitor,
            path: "/endpoints",
            subItems: [
              ...(canAccessAgents
                ? [
                    {
                      label: "Dashboard",
                      icon: LayoutDashboard,
                      path: "/endpoints/dashboard",
                    },
                    { label: "Agents", icon: Cpu, path: "/endpoints/agents" },
                  ]
                : []),
              { label: "Tasks", icon: Package, path: "/endpoints/tasks" },
            ],
          },
        ]
      : []),
  ];

  const toggleModule = (path: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const isModuleActive = (module: ModuleWithItems) => {
    if (module.path === "/dashboard") {
      return ["/dashboard", "/favorites"].includes(
        location.pathname,
      );
    }
    return location.pathname.startsWith(module.path);
  };

  const isItemActive = (path: string) => {
    const [basePath, queryString] = path.split("?");
    const currentSearch = new URLSearchParams(location.search);

    if (basePath === "/dashboard" && !queryString) {
      const currentTab = currentSearch.get("tab");
      return location.pathname === "/dashboard" && (!currentTab || currentTab === "dashboard");
    }
    if (basePath === "/favorites")
      return location.pathname === basePath;

    if (queryString) {
      const pathParams = new URLSearchParams(queryString);
      const pathTab = pathParams.get("tab");
      const currentTab = currentSearch.get("tab");
      return location.pathname === basePath && currentTab === pathTab;
    }

    if (basePath === "/analytics") {
      const currentTab = currentSearch.get("tab");
      return (
        location.pathname === "/analytics" &&
        (!currentTab || currentTab === "dashboard")
      );
    }

    return (
      location.pathname === path || location.pathname.startsWith(path + "/")
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "flex flex-col h-screen bg-sidebar border-r-[length:var(--theme-border-width)] border-sidebar-border transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "relative flex items-center h-14 px-3 border-b-[length:var(--theme-border-width)] border-sidebar-border overflow-hidden",
            collapsed ? "justify-center" : "justify-start",
          )}
        >
          <div
            className={cn(
              "absolute flex items-center justify-center w-8 h-8 rounded-base bg-sidebar-foreground shrink-0 transition-all duration-300",
              collapsed ? "opacity-100 scale-100" : "opacity-0 scale-75",
            )}
          >
            <Shield className="h-5 w-5 text-sidebar" />
          </div>
          <div
            className={cn(
              "flex items-center h-8 transition-all duration-300",
              collapsed ? "opacity-0 scale-95" : "opacity-100 scale-100",
            )}
          >
            <img
              src="/assets/logo-achilles.png?v=2"
              alt="ACHILLES"
              className="h-6 w-auto dark:invert"
            />
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-2 py-4">
          {!collapsed && (
            <p className="px-3 py-1.5 mb-1 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              Modules
            </p>
          )}

          <div className="flex flex-col gap-2">
            {modules.map((module) => {
              const active = isModuleActive(module);
              const expanded = expandedModules.has(module.path);
              const Icon = module.icon;

              if (collapsed) {
                // Locked modules: simple tooltip. Unlocked: flyout with sub-items.
                if (module.locked) {
                  return (
                    <Tooltip key={module.path} delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          className="flex items-center justify-center px-2 py-2.5 rounded-base cursor-default opacity-50 text-sidebar-foreground/70"
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[180px] text-center">
                        Requires configuration — go to Settings to unlock
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <div
                    key={module.path}
                    className={cn(
                      "flex items-center justify-center px-2 py-2.5 rounded-base text-sm font-medium transition-all cursor-pointer",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70",
                    )}
                    onClick={() => navigate(module.path)}
                    onMouseEnter={(e) => openFlyout(module, e)}
                    onMouseLeave={closeFlyout}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                  </div>
                );
              }

              const moduleRow = (
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-base text-sm font-medium transition-all select-none ",
                    module.locked
                      ? "cursor-default opacity-50 text-sidebar-foreground/70 border-transparent"
                      : "cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    !module.locked && active
                      ? "bg-sidebar-accent text-sidebar-foreground border-sidebar-border"
                      : !module.locked
                        ? "text-sidebar-foreground/70 border-transparent"
                        : "",
                  )}
                  onClick={() => {
                    if (!module.locked) navigate(module.path);
                  }}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{module.label}</span>
                  {module.locked ? (
                    <Lock className="h-3.5 w-3.5 opacity-60" />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleModule(module.path);
                      }}
                      className="p-0.5 rounded hover:bg-sidebar-border/20 cursor-pointer"
                    >
                      {expanded ? (
                        <ChevronUp className="h-4 w-4 opacity-60" />
                      ) : (
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      )}
                    </button>
                  )}
                </div>
              );

              return (
                <div key={module.path} className="mb-1">
                  {/* Module row — wrapped in tooltip when locked */}
                  {module.locked ? (
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div>{moduleRow}</div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="max-w-45 text-center"
                      >
                        Requires configuration — go to Settings to unlock
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    moduleRow
                  )}

                  {/* Sub-items — grid trick for smooth height transition */}
                  {!module.locked && (
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows] duration-200 ease-in-out",
                        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="ml-3 border-l border-sidebar-border pl-1 mt-0.5 space-y-0.5">
                      {module.subItems.map((item) => {
                        const itemActive = isItemActive(item.path);
                        const ItemIcon = item.icon;
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-base text-sm transition-all",
                              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              itemActive
                                ? "font-semibold text-sidebar-foreground"
                                : "font-medium text-sidebar-foreground/70",
                            )}
                          >
                            <ItemIcon className="h-4 w-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t-[length:var(--theme-border-width)] border-sidebar-border p-2">
          {canAccessSettings &&
            (collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to="/settings"
                    className={cn(
                      "flex items-center justify-center px-2 py-2.5 rounded-base text-sm font-medium transition-all",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      location.pathname === "/settings"
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70",
                    )}
                  >
                    <Settings className="h-5 w-5 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            ) : (
              <Link
                to="/settings"
                className={cn(
                  "flex gap-3 px-3 py-2.5 rounded-base text-sm font-medium transition-all",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  location.pathname === "/settings"
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70",
                )}
              >
                <Settings className="h-5 w-5 shrink-0" />
                <span>Settings</span>
              </Link>
            ))}
        </div>
      </aside>

      {/* Collapsed flyout panel — rendered in a portal to escape sidebar overflow */}
      {collapsed && flyoutModule && createPortal(
        <div
          style={{ top: flyoutY, left: 64 }}
          className="fixed z-50 min-w-[160px] bg-sidebar border border-sidebar-border rounded-base shadow-lg py-1"
          onMouseEnter={keepFlyout}
          onMouseLeave={closeFlyout}
        >
          <p className="px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
            {flyoutModule.label}
          </p>
          {flyoutModule.subItems.map((item) => {
            const ItemIcon = item.icon;
            const itemActive = isItemActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setFlyoutModule(null)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm transition-all",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  itemActive
                    ? "font-semibold text-sidebar-foreground"
                    : "font-medium text-sidebar-foreground/70",
                )}
              >
                <ItemIcon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>,
        document.body,
      )}
    </TooltipProvider>
  );
}
