"use client";

import { Badge } from "@/components/ui/badge";
import { useDroppable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";
import ApplicationCard from "./ApplicationCard";
import type {
  ApplicationStage,
  BoardDensity,
  GroupedApplication,
} from "./types";

type KanbanColumnProps = {
  id: ApplicationStage;
  title: string;
  items: GroupedApplication[];
  density: BoardDensity;
  onEdit: (id: string) => void;
  onCompletePlacement: (id: string) => void;
};

const VIRTUAL_THRESHOLD = 20;

export default function KanbanColumn({
  id,
  title,
  items,
  density,
  onEdit,
  onCompletePlacement,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const compact = density === "COMPACT";
  const estimatedItemHeight = compact ? 140 : 170;
  const useVirtual = items.length > VIRTUAL_THRESHOLD;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: useVirtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedItemHeight,
    overscan: 5,
  });

  return (
    <div
      ref={setNodeRef}
      className={`inline-flex shrink-0 flex-col rounded-lg ${compact ? "w-[220px] space-y-2 p-1.5" : "w-[260px] space-y-3 p-2"} ${
        isOver ? "bg-slate-100 dark:bg-slate-800" : ""
      }`}
      style={{ flex: compact ? "0 0 220px" : "0 0 260px" }}
    >
      <div className="flex items-center justify-between">
        <h2
          className={`whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200 ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {title}
        </h2>
        <Badge>{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <div
          className={`rounded border border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400 ${
            compact ? "px-2 py-2 text-[11px]" : "px-2 py-3 text-xs"
          }`}
        >
          No applications in this stage yet.
        </div>
      ) : useVirtual ? (
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{ maxHeight: "70vh" }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index];
              return (
                <div
                  key={item.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                >
                  <div className={compact ? "pb-2" : "pb-3"}>
                    <ApplicationCard
                      groupedApplication={item}
                      density={density}
                      onEdit={() => onEdit(item.representative.id)}
                      onCompletePlacement={() =>
                        onCompletePlacement(item.representative.id)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={compact ? "space-y-2" : "space-y-3"}>
          {items.map((item) => (
            <ApplicationCard
              key={item.id}
              groupedApplication={item}
              density={density}
              onEdit={() => onEdit(item.representative.id)}
              onCompletePlacement={() =>
                onCompletePlacement(item.representative.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
