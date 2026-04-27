import { formatUserError } from "@/lib/utils";

type HubSpotDealSyncInput = {
  dealName: string;
  amount: number;
  pipelineId?: string | null;
  dealStageId?: string | null;
  closeDate?: string | null;
  proposalSlug: string;
  clientName: string;
  clientEmail?: string | null;
  clientCompany?: string | null;
};

function getHubSpotHeaders() {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    return null;
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export function isHubSpotConfigured() {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

export async function createHubSpotDeal(input: HubSpotDealSyncInput) {
  const headers = getHubSpotHeaders();

  if (!headers) {
    return null;
  }

  const properties: Record<string, string> = {
    dealname: input.dealName,
    amount: String(Math.max(0, Math.round(input.amount))),
    description: `Everboarding proposal ${input.proposalSlug} · ${input.clientName}${input.clientCompany ? ` · ${input.clientCompany}` : ""}${input.clientEmail ? ` · ${input.clientEmail}` : ""}`,
  };

  if (input.pipelineId) properties.pipeline = input.pipelineId;
  if (input.dealStageId) properties.dealstage = input.dealStageId;
  if (input.closeDate) properties.closedate = new Date(`${input.closeDate}T00:00:00`).getTime().toString();
  const response = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
    method: "POST",
    headers,
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "No pudimos crear el negocio en HubSpot.");
  }

  const payload = (await response.json()) as { id: string; properties?: Record<string, string> };
  return payload;
}

export async function updateHubSpotDeal(dealId: string, properties: Record<string, string>) {
  const headers = getHubSpotHeaders();

  if (!headers) {
    return null;
  }

  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "No pudimos actualizar el negocio en HubSpot.");
  }

  return response.json();
}

export async function moveHubSpotDealToWon(dealId: string) {
  const wonStage = process.env.HUBSPOT_DEAL_STAGE_WON_ID;

  if (!wonStage) {
    return null;
  }

  return updateHubSpotDeal(dealId, {
    dealstage: wonStage,
  });
}

export function formatHubSpotError(error: unknown) {
  return formatUserError(error, "No pudimos sincronizar el negocio con HubSpot.");
}
