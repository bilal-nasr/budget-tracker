"use client";

import { useId } from "react";
import { useLocale } from "next-intl";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { categoryName, type Category } from "@/features/categories/schema";

/**
 * Compact category picker: one 48px field that opens a list, instead of a grid
 * that takes two rows of the sheet. Pass categories already filtered to one kind.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  label,
  placeholder,
  invalid,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  placeholder: string;
  invalid?: boolean;
}) {
  const locale = useLocale();
  const labelId = useId();
  const current = categories.find((c) => c.id === value);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">{label}</span>
      <Select value={value || null} onValueChange={(next) => next && onChange(next as string)}>
        <SelectTrigger aria-labelledby={labelId} aria-invalid={invalid ? true : undefined}>
          {current ? (
            <span className="flex min-w-0 items-center gap-3">
              <CategoryGlyph tile={current.tile} color={current.color} />
              <span className="truncate"><bdi>{categoryName(current, locale)}</bdi></span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <CategoryGlyph tile={c.tile} color={c.color} />
              <span className="truncate"><bdi>{categoryName(c, locale)}</bdi></span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
