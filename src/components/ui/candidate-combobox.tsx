"use client";

import { cn } from "@/lib/utils";
import * as React from "react";

export type ComboboxOption = {
  value: string;
  label: string;
};

type CandidateComboboxProps = {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  id?: string;
};

export function CandidateCombobox({
  options,
  value,
  onValueChange,
  placeholder = "Search candidates\u2026",
  id,
}: CandidateComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [highlightIndex, setHighlightIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options;
    const term = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  React.useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  React.useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlightIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const handleSelect = React.useCallback(
    (optionValue: string) => {
      onValueChange(optionValue);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onValueChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[highlightIndex]) {
          handleSelect(filtered[highlightIndex].value);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, filtered, highlightIndex, handleSelect],
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-listbox` : undefined}
        className={cn(
          "flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        )}
        placeholder={placeholder}
        value={open ? search : selectedLabel}
        onFocus={() => {
          setOpen(true);
          setSearch("");
        }}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul
          ref={listRef}
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {value && !search && (
            <li
              role="option"
              aria-selected={false}
              className="cursor-pointer select-none px-3 py-2 text-sm text-slate-400 hover:bg-slate-100"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect("");
              }}
            >
              Clear selection
            </li>
          )}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              No results found.
            </li>
          ) : (
            filtered.map((option, idx) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "cursor-pointer select-none px-3 py-2 text-sm",
                  idx === highlightIndex && "bg-slate-100",
                  option.value === value && "font-medium text-blue-700",
                )}
                onMouseEnter={() => setHighlightIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(option.value);
                }}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
