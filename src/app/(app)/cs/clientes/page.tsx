import { redirect } from "next/navigation";

import { ClientsCatalogManager, type ClientCatalogRow } from "@/components/cs/clients-catalog-manager";
import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProfileLookup = Pick<Tables<"profiles">, "id" | "email" | "full_name">;

export default async function ClientsCatalogPage() {
  const { platformProfile } = await requireUser("/cs/clientes");

  if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
    redirect("/dashboard");
  }

  const admin = createSupabaseAdminClient();
  const [
    { data: clientRows, error: clientsError },
    { data: profileRows, error: profilesError },
  ] = await Promise.all([
    admin
      .from("clients")
      .select("*")
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false }),
    admin
      .from("profiles")
      .select("id,email,full_name"),
  ]);

  if (clientsError) {
    throw new Error("No pudimos cargar el catalogo de clientes.");
  }

  if (profilesError) {
    throw new Error("No pudimos cargar los responsables de clientes.");
  }

  const profileMap = new Map(
    ((profileRows ?? []) as ProfileLookup[]).map((profile) => [profile.id, profile]),
  );

  const clients = ((clientRows ?? []) as Tables<"clients">[]).map<ClientCatalogRow>((client) => {
    const seller = client.seller_user_id ? profileMap.get(client.seller_user_id) : null;
    const csm = client.csm_user_id ? profileMap.get(client.csm_user_id) : null;

    return {
      id: client.id,
      name: client.name,
      slug: client.slug,
      description: client.description,
      is_active: client.is_active,
      seller_user_id: client.seller_user_id,
      csm_user_id: client.csm_user_id,
      created_at: client.created_at,
      updated_at: client.updated_at,
      seller_name: seller?.full_name ?? seller?.email ?? null,
      csm_name: csm?.full_name ?? csm?.email ?? null,
    };
  });

  return <ClientsCatalogManager initialClients={clients} />;
}
