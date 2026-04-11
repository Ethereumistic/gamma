import { useMemo, useState } from "react";
import { formatDateGroup } from "@/lib/date-utils";

export type SortOrder = "newest" | "oldest" | "a-z" | "z-a";

type FilterableItem = {
  name: string;
  isStarred?: boolean;
};

type UseFilterableListOptions<T extends FilterableItem> = {
  items: T[] | undefined;
  sortField: keyof T & (string | number);
};

/**
 * Generic hook for the search + sort + group-by-date pattern
 * used in sidebar item lists (Designs, NC Programs).
 */
export function useFilterableList<T extends FilterableItem>({
  items,
  sortField,
}: UseFilterableListOptions<T>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const groupedItems = useMemo(() => {
    if (!items) return new Map<string, T[]>();

    let filtered = items.filter(
      (item) =>
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      // Always put starred first
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;

      const aVal = a[sortField] as number;
      const bVal = b[sortField] as number;

      if (sortOrder === "newest") return bVal - aVal;
      if (sortOrder === "oldest") return aVal - bVal;
      if (sortOrder === "a-z") return a.name.localeCompare(b.name);
      if (sortOrder === "z-a") return b.name.localeCompare(a.name);
      return 0;
    });

    const groups = new Map<string, T[]>();
    filtered.forEach((item) => {
      const group = formatDateGroup(item[sortField] as number);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(item);
    });

    return groups;
  }, [items, searchQuery, sortOrder, sortField]);

  return {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    groupedItems,
  };
}
