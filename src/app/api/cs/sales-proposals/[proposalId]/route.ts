import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { getSalesProposalBySlug } from "@/lib/sales-proposal-access";
import { normalizeSalesPaymentMethod } from "@/lib/sales-proposals";
import { activatePaidSalesProposalAfterAssignment, saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalAssignmentRouteProps = {
  params: Promise<{ proposalId: string }>;
};

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export async function PUT(request: Request, { params }: SalesProposalAssignmentRouteProps) {
  try {
    const { proposalId } = await params;
    const { platformProfile } = await requireUser("/cs/ventas");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo el equipo interno autorizado puede gestionar este catalogo." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      sellerProfileId?: string | null;
      assignedCsmUserId?: string | null;
      paymentMethod?: string | null;
    };
    const sellerProfileId = body.sellerProfileId?.trim() || null;
    const assignedCsmUserId = body.assignedCsmUserId?.trim() || null;
    const paymentMethod = normalizeSalesPaymentMethod(body.paymentMethod);
    const admin = createSupabaseAdminClient();

    const { data, error: proposalError } = await admin
      .from("sales_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    const currentProposal = data as SalesProposalRow | null;

    if (proposalError) {
      throw proposalError;
    }

    if (!currentProposal) {
      return NextResponse.json({ message: "No encontramos la venta seleccionada." }, { status: 404 });
    }

    const storedProposal = await getSalesProposalBySlug(currentProposal.slug);

    if (!storedProposal) {
      return NextResponse.json({ message: "No encontramos el plan completo de la venta seleccionada." }, { status: 404 });
    }

    const isTransferFlowRequest = paymentMethod === "bank_transfer";
    const canRouteCurrentProposalToFinance =
      currentProposal.status === "draft" || currentProposal.status === "transfer_pending";
    const shouldRouteToFinance = isTransferFlowRequest && canRouteCurrentProposalToFinance;

    if (
      isTransferFlowRequest &&
      !canRouteCurrentProposalToFinance &&
      currentProposal.payment_method !== "bank_transfer"
    ) {
      return NextResponse.json(
        { message: "Solo puedes enviar a Finanzas propuestas que aun no hayan pasado por checkout o pago." },
        { status: 400 },
      );
    }

    if (currentProposal.activated_client_id && !assignedCsmUserId) {
      return NextResponse.json(
        { message: "No puedes dejar sin CS una venta que ya fue activada." },
        { status: 400 },
      );
    }

    if (currentProposal.activated_client_id && shouldRouteToFinance) {
      return NextResponse.json(
        { message: "No puedes mover a Finanzas una venta que ya fue activada." },
        { status: 400 },
      );
    }

    let resolvedSellerProfile:
      | Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "email" | "full_name" | "platform_role">
      | null = null;

    if (sellerProfileId) {
      const { data: sellerProfileData, error: sellerProfileError } = await admin
        .from("profiles")
        .select("id, email, full_name, platform_role")
        .eq("id", sellerProfileId)
        .eq("is_platform_active", true)
        .maybeSingle();
      const sellerProfile = sellerProfileData as
        | Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "email" | "full_name" | "platform_role">
        | null;

      if (sellerProfileError) {
        throw sellerProfileError;
      }

      if (!sellerProfile || (sellerProfile.platform_role !== "sales" && sellerProfile.platform_role !== "superadmin")) {
        return NextResponse.json(
          { message: "El vendedor seleccionado ya no esta disponible." },
          { status: 400 },
        );
      }

      resolvedSellerProfile = sellerProfile;
    }

    const nextAssignedCsmUserId = shouldRouteToFinance ? null : assignedCsmUserId;
    const nextStatus = shouldRouteToFinance ? "transfer_pending" : storedProposal.proposal.status;
    const nextSellerName = resolvedSellerProfile?.full_name?.trim() || "";
    const nextSellerEmail = resolvedSellerProfile?.email.trim().toLowerCase() || "";
    const nextSellerCompany = resolvedSellerProfile ? "Dinterweb" : "";
    const nextWorkspaceVariant =
      resolvedSellerProfile &&
      (resolvedSellerProfile.platform_role === "sales" || resolvedSellerProfile.platform_role === "superadmin")
        ? "dinterweb"
        : storedProposal.proposal.workspaceVariant;

    const shouldActivateAfterAssignment =
      Boolean(nextAssignedCsmUserId) &&
      !currentProposal.activated_client_id &&
      currentProposal.status === "paid";

    const updatedProposal = await saveSalesProposal(
      {
        ...storedProposal.proposal,
        sellerName: nextSellerName,
        sellerEmail: nextSellerEmail,
        sellerCompany: nextSellerCompany,
        assignedCsmUserId: nextAssignedCsmUserId || "",
        paymentMethod,
        status: nextStatus,
        workspaceVariant: nextWorkspaceVariant,
      },
      storedProposal.proposal.slug ?? currentProposal.slug,
    );

    if (shouldActivateAfterAssignment) {
      await activatePaidSalesProposalAfterAssignment(proposalId);

      const activatedProposal = await getSalesProposalBySlug(currentProposal.slug);

      if (!activatedProposal) {
        throw new Error("No pudimos refrescar la venta activada.");
      }

      return NextResponse.json(activatedProposal.proposal);
    }

    if (currentProposal.activated_client_id && nextAssignedCsmUserId) {
      const { error: clientError } = await admin
        .from("clients")
        .update(({
          seller_user_id: sellerProfileId,
          owner_user_id: nextAssignedCsmUserId,
          csm_user_id: nextAssignedCsmUserId,
        }) as never)
        .eq("id", currentProposal.activated_client_id);

      if (clientError) {
        throw clientError;
      }

      const { error: initiativesError } = await admin
        .from("onboarding_initiatives")
        .update(({
          owner_csm: nextAssignedCsmUserId,
          updated_by_user_id: nextAssignedCsmUserId,
        }) as never)
        .eq("client_id", currentProposal.activated_client_id);

      if (initiativesError) {
        throw initiativesError;
      }

      const { error: configError } = await admin
        .from("onboarding_configs")
        .update(({
          updated_by_user_id: nextAssignedCsmUserId,
        }) as never)
        .eq("client_id", currentProposal.activated_client_id);

      if (configError) {
        throw configError;
      }
    } else if (currentProposal.activated_client_id) {
      const { error: sellerClientError } = await admin
        .from("clients")
        .update(({
          seller_user_id: sellerProfileId,
        }) as never)
        .eq("id", currentProposal.activated_client_id);

      if (sellerClientError) {
        throw sellerClientError;
      }
    }

    return NextResponse.json(updatedProposal);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la asignacion de CS.") },
      { status: 400 },
    );
  }
}
