import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSalesProposalCheckout } from "@/lib/sales-proposals-server";
import { mapSalesProposalRow } from "@/lib/sales-proposals";
import { formatUserError } from "@/lib/utils";

type SalesProposalActivateRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, { params }: SalesProposalActivateRouteProps) {
  try {
    const { slug } = await params;
    const admin = createSupabaseAdminClient();
    const { data: proposalRow, error } = await admin
      .from("sales_proposals")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !proposalRow) {
      return NextResponse.json(
        { message: "No encontramos la propuesta que quieres activar." },
        { status: 404 },
      );
    }

    const checkoutUrl = await createSalesProposalCheckout(request, mapSalesProposalRow(proposalRow));

    return NextResponse.json({ url: checkoutUrl });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos activar el plan ni preparar el checkout del cliente.",
        ),
      },
      { status: 400 },
    );
  }
}
