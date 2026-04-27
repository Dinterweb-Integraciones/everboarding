import { CatalogGroupsManager } from "@/components/cs/catalog-groups-manager";
import { requireUser } from "@/lib/auth";
import type { CreditCatalogGroup, CreditCatalogGroupItem, CreditCatalogItem } from "@/lib/onboarding";

export default async function CatalogGroupsPage() {
  const { supabase } = await requireUser();

  const [
    { data: groupRows, error: groupsError },
    { data: itemRows, error: itemsError },
    { data: membershipRows, error: membershipsError },
  ] = await Promise.all([
    supabase.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    supabase.from("credit_catalog_items").select("*").order("category").order("sort_order").order("label"),
    supabase.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
  ]);

  if (groupsError) {
    throw new Error("No pudimos cargar los grupos de casos de uso.");
  }

  if (itemsError) {
    throw new Error("No pudimos cargar el catálogo de tareas.");
  }

  if (membershipsError) {
    throw new Error("No pudimos cargar la composición de los grupos.");
  }

  return (
    <CatalogGroupsManager
      initialGroups={(groupRows ?? []) as CreditCatalogGroup[]}
      initialItems={(itemRows ?? []) as CreditCatalogItem[]}
      initialMemberships={(membershipRows ?? []) as CreditCatalogGroupItem[]}
    />
  );
}
