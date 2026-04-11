import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { systemItems, toolItems } from "@/lib/navigation";

export function SidebarNavSection() {
  const location = useLocation();
  const pathIsSheetMetal = location.pathname.startsWith("/sheet-metal");
  const isInternalToolRoute = pathIsSheetMetal || location.pathname.startsWith("/cnc-pipeline");

  return (
    <>
      {!isInternalToolRoute && (
        <SidebarGroup className="pb-0">
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-2">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "h-10 px-3 rounded-xl border",
                        isActive
                          ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm"
                          : "text-slate-400 border-transparent hover:bg-white/5 hover:text-white"
                      )}
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md",
                          isActive ? "bg-primary/20 text-primary shadow-neon-green-sm" : "bg-black/40 text-slate-500"
                        )}>
                          <item.icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="font-bold text-[10px] uppercase tracking-widest">{item.title}</span>
                        {isActive && (
                          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-neon-green animate-pulse" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarGroup>
        <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-3 mt-2">
          Internal Tools
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="grid grid-cols-2 gap-2.5 px-2">
            {toolItems.map((item) => {
              const isActive = item.url === "/sheet-metal" ? pathIsSheetMetal : location.pathname.startsWith(item.url);
              return (
                <Link
                  key={item.title}
                  to={item.url}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border group transition-all duration-300",
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm scale-[0.98]"
                      : "bg-white/[0.03] border-white/5 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-white hover:scale-105"
                  )}
                >
                  <div className={cn(
                    "p-3 rounded-xl transition-all duration-300",
                    isActive ? "bg-primary/20 shadow-neon-green" : "bg-black/40 group-hover:scale-110"
                  )}>
                    <item.icon className={cn("h-7 w-7", isActive ? "text-primary" : "text-slate-400")} />
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] text-center opacity-80">
                    {item.title}
                  </span>
                </Link>
              );
            })}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
