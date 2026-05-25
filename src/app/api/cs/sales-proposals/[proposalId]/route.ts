import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { mapSalesProposalRow, normalizeSalesPaymentMethod } from "@/lib/sales-proposals";
import { activatePaidSalesProposalAfterAssignment } from "@/lib/sales-proposals-server";
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
      assignedCsmUserId?: string | null;
      paymentMethod?: string | null;
    };
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

    const currentSnapshot =
      currentProposal.snapshot && typeof currentProposal.snapshot === "object"
        ? (currentProposal.snapshot as Record<string, unknown>)
        : {};

    const nextAssignedCsmUserId = shouldRouteToFinance ? null : assignedCsmUserId;
    const nextStatus = shouldRouteToFinance ? "transfer_pending" : currentProposal.status;

    const shouldActivateAfterAssignment =
      Boolean(nextAssignedCsmUserId) &&
      !currentProposal.activated_client_id &&
      currentProposal.status === "paid";

    const { data: updatedData, error: updateError } = await admin
      .from("sales_proposals")
      .update(({
        assigned_csm_user_id: nextAssignedCsmUserId,
        payment_method: paymentMethod,
        status: nextStatus,
        snapshot: {
          ...currentSnapshot,
          assignedCsmUserId: nextAssignedCsmUserId ?? "",
          paymentMethod,
        },
      }) as never)
      .eq("id", proposalId)
      .select("*")
      .single();
    const updatedProposal = updatedData as SalesProposalRow | null;

    if (updateError || !updatedProposal) {
      throw updateError ?? new Error("No pudimos actualizar la venta.");
    }

    if (shouldActivateAfterAssignment) {
      await activatePaidSalesProposalAfterAssignment(proposalId);

      const { data: activatedData, error: activatedError } = await admin
        .from("sales_proposals")
        .select("*")
        .eq("id", proposalId)
        .single();
      const activatedProposal = activatedData as SalesProposalRow | null;

      if (activatedError || !activatedProposal) {
        throw activatedError ?? new Error("No pudimos refrescar la venta activada.");
      }

      return NextResponse.json(mapSalesProposalRow(activatedProposal));
    }

    if (currentProposal.activated_client_id && nextAssignedCsmUserId) {
      const { error: clientError } = await admin
        .from("clients")
        .update(({
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
    }

    return NextResponse.json(mapSalesProposalRow(updatedProposal as SalesProposalRow));
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la asignacion de CS.") },
      { status: 400 },
    );
  }
}
