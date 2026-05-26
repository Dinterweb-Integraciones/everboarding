export type DropPosition = "before" | "after";

type ReorderBoardItemsOptions<TItem, TStatus extends string> = {
  items: TItem[];
  draggedId: string;
  targetStatus: TStatus;
  targetId?: string | null;
  position?: DropPosition;
  getId: (item: TItem) => string;
  getStatus: (item: TItem) => TStatus;
  getSortOrder: (item: TItem) => number;
  updateItem: (item: TItem, patch: { status: TStatus; sortOrder: number }) => TItem;
};

export type ReorderBoardItemsResult<TItem> = {
  items: TItem[];
  changedItems: TItem[];
  statusChanged: boolean;
};

export function reorderBoardItems<TItem, TStatus extends string>({
  items,
  draggedId,
  targetStatus,
  targetId,
  position = "before",
  getId,
  getStatus,
  getSortOrder,
  updateItem,
}: ReorderBoardItemsOptions<TItem, TStatus>): ReorderBoardItemsResult<TItem> | null {
  const draggedItem = items.find((item) => getId(item) === draggedId);
  if (!draggedItem) {
    return null;
  }

  if (targetId && targetId === draggedId) {
    return null;
  }

  const sourceStatus = getStatus(draggedItem);
  const statusChanged = sourceStatus !== targetStatus;
  const remainingItems = items.filter((item) => getId(item) !== draggedId);

  const sourceItems = remainingItems
    .filter((item) => getStatus(item) === sourceStatus)
    .sort((left, right) => getSortOrder(left) - getSortOrder(right));

  const targetItems = (statusChanged
    ? remainingItems.filter((item) => getStatus(item) === targetStatus)
    : sourceItems
  ).sort((left, right) => getSortOrder(left) - getSortOrder(right));

  const targetIndex = targetId
    ? targetItems.findIndex((item) => getId(item) === targetId)
    : -1;
  const insertionIndex =
    targetIndex === -1
      ? targetItems.length
      : targetIndex + (position === "after" ? 1 : 0);

  const reorderedTargetItems = [...targetItems];
  reorderedTargetItems.splice(
    Math.max(0, Math.min(insertionIndex, reorderedTargetItems.length)),
    0,
    updateItem(draggedItem, { status: targetStatus, sortOrder: 0 }),
  );

  const nextItemsById = new Map<string, TItem>();
  const changedItems: TItem[] = [];

  const writeNormalizedItems = (list: TItem[], status: TStatus) => {
    list.forEach((item, index) => {
      const nextItem = updateItem(item, { status, sortOrder: index });
      nextItemsById.set(getId(nextItem), nextItem);

      const previousItem = items.find((current) => getId(current) === getId(nextItem));
      if (
        previousItem &&
        (getStatus(previousItem) !== status || getSortOrder(previousItem) !== index)
      ) {
        changedItems.push(nextItem);
      }
    });
  };

  if (statusChanged) {
    writeNormalizedItems(sourceItems, sourceStatus);
  }
  writeNormalizedItems(reorderedTargetItems, targetStatus);

  if (changedItems.length === 0) {
    return null;
  }

  return {
    items: items.map((item) => nextItemsById.get(getId(item)) ?? item),
    changedItems,
    statusChanged,
  };
}
