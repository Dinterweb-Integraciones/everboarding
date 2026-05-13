import { NextResponse } from "next/server";

import {
  getSalesProposalBySlug,
  mapProposalInitiativeToPublicRecord,
} from "@/lib/public-prospect";
import { createLocalId, type SalesProposalRecord } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError, toIsoDate } from "@/lib/utils";

type RouteContext = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
};

type PublicTargetStatus = "backlog" | "planned";

type CatalogItemRecord = {
  id: string;
  label: string;
  credits: number;
  is_active: boolean;
};

type InitiativeRow = {
  id: string;
  labels?: string[] | null;
};

type InsertedSubitemRow = {
  unit_credits?: number | null;
  quantity?: number | null;
} & Record<string, unknown>;

type GroupRecord = {
  id: string;
  name: string;
  description: string | null;
  credits: number | null;
};

export async function POST(request: Request, context: RouteContext) {
  const { audience, slug } = await context.params;

  if (audience !== "client" && audience !== "prospect") {
    return NextResponse.json(
      { message: "Esta vista publica no permite crear iniciativas." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      catalogItemIds?: string[];
      groupId?: string;
      targetStatus?: string;
    };

    if (!body.title?.trim()) {
      return NextResponse.json(
        { message: "Escribe un titulo para registrar la solicitud." },
        { status: 400 },
      );
    }

    if (!body.catalogItemIds?.length && !body.groupId?.trim()) {
      return NextResponse.json(
        { message: "Selecciona al menos una tarea o un grupo del catalogo." },
        { status: 400 },
      );
    }

    const targetStatus: PublicTargetStatus =
      audience === "prospect"
        ? "backlog"
        : body.targetStatus === "planned"
          ? "planned"
          : "backlog";
    const admin = createSupabaseAdminClient();
    const proposal = audience === "prospect" ? await getSalesProposalBySlug(slug) : null;
    let resolvedClientId: string | null = null;

    if (!proposal) {
      const { data: snapshot, error: snapshotError } = await admin.rpc(
        "get_public_onboarding_snapshot" as never,
        {
          p_slug: slug,
        } as never,
      );
      const snapshotData = snapshot as { client?: { id?: string } } | null;
      const clientId = snapshotData?.client?.id ?? null;

      if (snapshotError || !clientId) {
        return NextResponse.json(
          {
            message: formatUserError(
              snapshotError,
              "No fue posible ubicar el cliente para esta solicitud publica.",
            ),
          },
          { status: 400 },
        );
      }

      resolvedClientId = clientId;
    }

    async function createClientInitiativeWithItems(input: {
      title: string;
      description: string | null;
      type: string;
      items: CatalogItemRecord[];
      fallbackCredits?: number;
    }) {
      if (!resolvedClientId) {
        throw new Error("No fue posible ubicar el cliente para esta solicitud publica.");
      }

      const { data: existingForStatus, error: sortError } = await admin
        .from("onboarding_initiatives")
        .select("sort_order")
        .eq("client_id", resolvedClientId)
        .eq("status", targetStatus)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const existingRow = existingForStatus as { sort_order?: number } | null;

      if (sortError) {
        throw new Error(
          formatUserError(sortError, "No fue posible reservar la posicion de la nueva solicitud."),
        );
      }

      const today = toIsoDate();
      const { data: initiative, error: initiativeError } = await admin
        .from("onboarding_initiatives" as never)
        .insert({
          client_id: resolvedClientId,
          title: input.title.trim(),
          type: input.type,
          status: targetStatus,
          description: input.description,
          owner_client: null,
          owner_csm: null,
          est_start_date: null,
          est_end_date: null,
          date_planned: today,
          last_activity: today,
          is_blocked: false,
          sort_order: (existingRow?.sort_order ?? -1) + 1,
          created_by_user_id: null,
          updated_by_user_id: null,
        } as never)
        .select("*")
        .single();
      const initiativeRow = initiative as InitiativeRow | null;

      if (initiativeError || !initiativeRow) {
        throw new Error(
          formatUserError(initiativeError, "No fue posible registrar la solicitud publica."),
        );
      }

      const subitemsPayload = input.items.length
        ? input.items.map((item, index) => ({
            initiative_id: initiativeRow.id,
            catalog_item_id: item.id,
            name: item.label,
            status: "pending" as const,
            target_date: null,
            unit_credits: item.credits,
            quantity: 1,
            sort_order: index,
          }))
        : [
            {
              initiative_id: initiativeRow.id,
              catalog_item_id: null,
              name: input.title.trim(),
              status: "pending" as const,
              target_date: null,
              unit_credits: Math.max(1, Number(input.fallbackCredits ?? 0)),
              quantity: 1,
              sort_order: 0,
            },
          ];

      const { data: insertedSubitems, error: subitemsError } = await admin
        .from("onboarding_initiative_subitems" as never)
        .insert(subitemsPayload as never)
        .select("*");
      const insertedSubitemRows = (insertedSubitems ?? []) as InsertedSubitemRow[];

      if (subitemsError) {
        throw new Error(
          formatUserError(subitemsError, "No fue posible registrar las tareas de la solicitud."),
        );
      }

      const { data: insertedLogs, error: logsError } = await admin
        .from("onboarding_activity_logs" as never)
        .insert({
          initiative_id: initiativeRow.id,
          entry: "Solicitud creada desde la vista publica.",
          created_by_user_id: null,
        } as never)
        .select("*");
      const insertedLogRows = (insertedLogs ?? []) as Array<Record<string, unknown>>;

      if (logsError) {
        throw new Error(
          formatUserError(logsError, "No fue posible registrar la bitacora de la solicitud."),
        );
      }

      const credits = insertedSubitemRows.reduce(
        (sum, subitem) => sum + Number(subitem.unit_credits ?? 0) * Number(subitem.quantity ?? 1),
        0,
      );

      return {
        ...initiativeRow,
        labels: initiativeRow.labels ?? [],
        subitems: insertedSubitemRows,
        logs: insertedLogRows,
        credits,
        progressPercent: 0,
      };
    }

    async function createProposalInitiativeWithItems(
      activeProposal: SalesProposalRecord,
      input: {
        title: string;
        description: string | null;
        type: string;
        items: CatalogItemRecord[];
        fallbackCredits?: number;
      },
    ) {
      const nextSortOrder =
        activeProposal.initiatives
          .filter((initiative) => initiative.status === targetStatus)
          .reduce((max, initiative) => Math.max(max, Number(initiative.sortOrder ?? -1)), -1) + 1;
      const nextInitiative = {
        id: createLocalId("sales-initiative"),
        title: input.title.trim(),
        type: input.type,
        status: "backlog" as const,
        description: input.description || "",
        estStartDate: "",
        estEndDate: "",
        sortOrder: nextSortOrder,
        isBlocked: false,
        subitems: input.items.length
          ? input.items.map((item) => ({
              id: createLocalId("sales-subitem"),
              catalogItemId: item.id,
              name: item.label,
              status: "pending" as const,
              targetDate: "",
              unitCredits: Number(item.credits ?? 0),
              quantity: 1,
            }))
          : [
              {
                id: createLocalId("sales-subitem"),
                catalogItemId: null,
                name: input.title.trim(),
                status: "pending" as const,
                targetDate: "",
                unitCredits: Math.max(1, Number(input.fallbackCredits ?? 0)),
                quantity: 1,
              },
            ],
      };
      const savedProposal = await saveSalesProposal(
        {
          ...activeProposal,
          initiatives: [...activeProposal.initiatives, nextInitiative],
        },
        activeProposal.slug || activeProposal.id || slug,
      );

      return mapProposalInitiativeToPublicRecord(nextInitiative, savedProposal, nextSortOrder);
    }

    async function createInitiativeWithItems(input: {
      title: string;
      description: string | null;
      type: string;
      items: CatalogItemRecord[];
      fallbackCredits?: number;
    }) {
      if (proposal) {
        return createProposalInitiativeWithItems(proposal, input);
      }

      return createClientInitiativeWithItems(input);
    }

    if (body.groupId?.trim()) {
      const { data: group, error: groupError } = await admin
        .from("credit_catalog_groups")
        .select("id, name, description, credits")
        .eq("id", body.groupId.trim())
        .eq("is_active", true)
        .maybeSingle();
      const groupRecord = group as GroupRecord | null;

      if (groupError || !groupRecord) {
        return NextResponse.json(
          { message: "El grupo seleccionado ya no esta disponible." },
          { status: 400 },
        );
      }

      const { data: membershipRows, error: membershipsError } = await admin
        .from("credit_catalog_group_items")
        .select("catalog_item_id, sort_order")
        .eq("group_id", groupRecord.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      const typedMembershipRows = (membershipRows ?? []) as Array<{
        catalog_item_id: string;
        sort_order: number;
      }>;

      if (membershipsError) {
        return NextResponse.json(
          {
            message: formatUserError(
              membershipsError,
              "No fue posible cargar las tareas del grupo seleccionado.",
            ),
          },
          { status: 400 },
        );
      }

      const catalogItemIds = typedMembershipRows.map((membership) => membership.catalog_item_id);
      const { data: catalogItems, error: catalogItemsError } = catalogItemIds.length
        ? await admin
            .from("credit_catalog_items")
            .select("id, label, credits, is_active")
            .in("id", catalogItemIds)
        : { data: [], error: null };
      const typedCatalogItems = (catalogItems ?? []) as CatalogItemRecord[];

      if (catalogItemsError) {
        return NextResponse.json(
          {
            message: formatUserError(
              catalogItemsError,
              "No fue posible cargar las tareas del grupo seleccionado.",
            ),
          },
          { status: 400 },
        );
      }

      const activeItemsById = new Map(
        typedCatalogItems
          .filter((item) => item.is_active)
          .map((item) => [item.id, item] as const),
      );
      const orderedItems = typedMembershipRows
        .map((membership) => activeItemsById.get(membership.catalog_item_id))
        .filter((item): item is CatalogItemRecord => Boolean(item));

      const createdInitiative = await createInitiativeWithItems({
        title: body.title.trim(),
        description: body.description?.trim() || groupRecord.description || null,
        type: groupRecord.name,
        items: orderedItems,
        fallbackCredits: Number(groupRecord.credits ?? 0),
      });

      return NextResponse.json({
        ...createdInitiative,
        selected_catalog_item_ids: orderedItems.map((item) => item.id),
        selected_group_id: groupRecord.id,
      });
    }

    const requestedCatalogItemIds = Array.from(
      new Set((body.catalogItemIds ?? []).map((value) => value.trim()).filter(Boolean)),
    );

    if (!requestedCatalogItemIds.length) {
      return NextResponse.json(
        { message: "Selecciona al menos una tarea valida para registrar la solicitud." },
        { status: 400 },
      );
    }

    const { data: catalogItems, error: catalogItemsError } = await admin
      .from("credit_catalog_items")
      .select("id, label, credits, is_active")
      .in("id", requestedCatalogItemIds);
    const typedCatalogItems = (catalogItems ?? []) as CatalogItemRecord[];

    if (catalogItemsError) {
      return NextResponse.json(
        {
          message: formatUserError(
            catalogItemsError,
            "No fue posible cargar las tareas seleccionadas.",
          ),
        },
        { status: 400 },
      );
    }

    const activeItemsById = new Map(
      typedCatalogItems
        .filter((item) => item.is_active)
        .map((item) => [item.id, item] as const),
    );
    const orderedItems = requestedCatalogItemIds
      .map((itemId) => activeItemsById.get(itemId))
      .filter((item): item is CatalogItemRecord => Boolean(item));

    if (!orderedItems.length) {
      return NextResponse.json(
        { message: "Las tareas seleccionadas ya no estan disponibles." },
        { status: 400 },
      );
    }

    const createdInitiative = await createInitiativeWithItems({
      title: body.title.trim(),
      description: body.description?.trim() || null,
      type: "Solicitud publica",
      items: orderedItems,
    });

    return NextResponse.json({
      ...createdInitiative,
      selected_catalog_item_ids: orderedItems.map((item) => item.id),
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No fue posible registrar la solicitud publica.",
        ),
      },
      { status: 500 },
    );
  }
}
