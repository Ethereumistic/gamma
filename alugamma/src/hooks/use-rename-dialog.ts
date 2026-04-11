import { useState, useCallback } from "react";

type RenameItem<Id> = { id: Id; name: string };

type UseRenameDialogOptions<Id> = {
  onConfirm: (id: Id, name: string) => Promise<void> | void;
  minLength?: number;
  /** Additional guard that must return true before confirming */
  guard?: () => boolean;
};

/**
 * Generic hook for the rename dialog pattern used in sidebar item lists.
 * Manages the open/close state and the rename value.
 */
export function useRenameDialog<Id>({
  onConfirm,
  minLength = 2,
  guard,
}: UseRenameDialogOptions<Id>) {
  const [itemToRename, setItemToRename] = useState<RenameItem<Id> | null>(null);

  const renameValue = itemToRename?.name ?? "";

  const setRenameValue = useCallback(
    (value: string) => {
      setItemToRename((prev) =>
        prev ? { ...prev, name: value } : null
      );
    },
    []
  );

  const openDialog = useCallback(
    (item: RenameItem<Id>) => setItemToRename(item),
    []
  );

  const closeDialog = useCallback(() => setItemToRename(null), []);

  const canConfirm =
    itemToRename !== null && itemToRename.name.trim().length >= minLength && (!guard || guard());

  const confirmRename = useCallback(async () => {
    if (!itemToRename || !canConfirm) return;
    await onConfirm(itemToRename.id, itemToRename.name.trim());
    setItemToRename(null);
  }, [itemToRename, canConfirm, onConfirm, guard]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canConfirm) {
        e.preventDefault();
        void confirmRename();
      }
    },
    [canConfirm, confirmRename]
  );

  return {
    isOpen: itemToRename !== null,
    itemToRename,
    renameValue,
    setRenameValue,
    openDialog,
    closeDialog,
    canConfirm,
    confirmRename,
    handleKeyDown,
  };
}
