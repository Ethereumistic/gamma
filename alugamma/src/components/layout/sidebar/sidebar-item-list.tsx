import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FileStack, Filter, MoreHorizontal, Plus, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFilterableList, type SortOrder } from "@/hooks/use-filterable-list";

type FilterableItem = {
  name: string;
  isStarred?: boolean;
};

type ItemAction = {
  label: string;
  labelActive?: string;
  onClick: () => void;
  destructive?: boolean;
};

type SidebarItemListProps<T extends FilterableItem> = {
  label: ReactNode;
  searchPlaceholder: string;
  emptyMessage: string;
  items: T[] | undefined;
  sortField: keyof T & (string | number);
  activeItemId?: string;
  getItemUrl: (item: T) => string;
  getItemId: (item: T) => string;
  onAdd: () => void;
  addTitle?: string;
  renderIcon: (item: T) => ReactNode;
  renderItemMeta?: (item: T) => ReactNode;
  getActions: (item: T) => ItemAction[];
  onDuplicate?: (item: T) => Promise<void>;
  onRename: (item: T) => void;
  onDelete: (item: T) => void;
};

export function SidebarItemList<T extends FilterableItem>({
  label,
  searchPlaceholder,
  emptyMessage,
  items,
  sortField,
  activeItemId,
  getItemUrl,
  getItemId,
  onAdd,
  addTitle,
  renderIcon,
  renderItemMeta,
  getActions,
  onDuplicate,
  onRename,
  onDelete,
}: SidebarItemListProps<T>) {
  const location = useLocation();

  const {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    groupedItems,
  } = useFilterableList<T>({ items, sortField });

  const isActive = (item: T) => location.pathname === getItemUrl(item);
  const hasItems = items && items.length > 0;
  const hasResults = groupedItems.size > 0;

  return (
    <SidebarGroup className="min-h-0 flex-1 overflow-hidden flex flex-col pt-0">
      <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80 pt-6 pb-3 px-4 flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-primary" />
        {label}
      </SidebarGroupLabel>

      <div className="px-3 pb-3 pt-1 flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="neon"
            size="icon"
            onClick={onAdd}
            className="shrink-0 h-8 w-8 shadow-neon-green-sm"
            title={addTitle ?? "New"}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 bg-black/20 border-white/10 text-xs focus-visible:ring-1 focus-visible:ring-primary/50"
            />
          </div>
          <SortDropdown sortOrder={sortOrder} onSortChange={setSortOrder} />
        </div>
      </div>

      <SidebarGroupContent className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-3 pl-3">
          <SidebarMenuSub className="space-y-4 pr-1 pl-0 mx-0 border-none">
            {!hasItems ? (
              <div className="rounded-lg border border-dashed border-white/8 px-3 py-4 text-center text-xs text-slate-500 mx-2">
                {emptyMessage}
              </div>
            ) : !hasResults ? (
              <div className="text-center text-xs text-slate-500 mx-2 py-4">
                No items match &quot;{searchQuery}&quot;
              </div>
            ) : (
              Array.from(groupedItems.entries()).map(([group, groupItems]) => (
                <div key={group}>
                  <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500/80">
                    {group}
                  </div>
                  <ul className="space-y-0.5">
                    {groupItems.map((item) => {
                      const itemId = getItemId(item);
                      const itemActive = activeItemId === itemId || isActive(item);
                      const actions = getActions(item);

                      return (
                        <SidebarMenuSubItem key={itemId} className="group/item relative">
                          <SidebarMenuSubButton
                            asChild
                            isActive={itemActive}
                            className={cn(
                              "pr-8 h-8 outline-none w-full flex items-center gap-2",
                              itemActive
                                ? "bg-primary/10 text-primary border-r-2 border-primary"
                                : "text-slate-400 hover:text-white"
                            )}
                          >
                            <Link to={getItemUrl(item)}>
                              {renderIcon(item)}
                              <span className="truncate flex-1">{item.name}</span>
                              {renderItemMeta?.(item)}
                            </Link>
                          </SidebarMenuSubButton>

                          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                            {onDuplicate && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 hover:bg-white/10 text-slate-400 hover:text-white"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  await onDuplicate(item);
                                }}
                                title="Duplicate"
                              >
                                <FileStack className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {actions.length > 0 && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 hover:bg-white/10 aria-expanded:bg-white/10 text-slate-400 hover:text-white"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48 border-white/10 bg-[#090d16] text-slate-200">
                                  {actions.map((action, i) => (
                                    <span key={i}>
                                      <DropdownMenuItem
                                        onClick={action.onClick}
                                        className={cn(
                                          action.destructive
                                            ? "text-red-400 focus:text-red-300 focus:bg-red-400/10 hover:text-red-300 hover:bg-red-400/10"
                                            : "hover:bg-white/10"
                                        )}
                                      >
                                        {action.label}
                                      </DropdownMenuItem>
                                      {action.destructive && i === actions.length - 1 && (
                                        <DropdownMenuSeparator className="bg-white/5" />
                                      )}
                                    </span>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </SidebarMenuSub>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SortDropdown({
  sortOrder,
  onSortChange,
}: {
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 h-8 w-8 bg-transparent border-white/10 hover:bg-white/5">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 border-white/10 bg-[#090d16] text-slate-200">
        <DropdownMenuItem onClick={() => onSortChange("newest")} className="hover:bg-white/10">Newest first</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSortChange("oldest")} className="hover:bg-white/10">Oldest first</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSortChange("a-z")} className="hover:bg-white/10">A-Z</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSortChange("z-a")} className="hover:bg-white/10">Z-A</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
