import "server-only";
import { cache } from "react";
import { DEMO_CATEGORIES } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import type { Category } from "./schema";

export const getCategories = cache(async (): Promise<Category[]> => {
  if (!supabaseConfigured()) return DEMO_CATEGORIES.map((c) => ({ ...c, parentId: c.parentId ?? null, archivedAt: c.archivedAt ?? null }));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, kind, name_en, name_ar, tile, color, position, parent_id, archived_at")
    .order("position")
    .order("id");
  if (error || !data) {
    throw new Error("category_catalogue_unavailable");
  }
  return data.map((c) => ({
    id: c.id,
    kind: c.kind,
    nameEn: c.name_en,
    nameAr: c.name_ar,
    tile: c.tile,
    color: c.color,
    position: c.position,
    parentId: c.parent_id,
    archivedAt: c.archived_at,
  }));
});
