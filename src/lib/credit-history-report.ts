// Cálculo del informe de Operaciones: créditos por cliente en su ciclo vigente (contratados,
// caudal, disponibles, comprometidos, completados, etc.).

type CycleColumnColor = "verde" | "naranja" | "rojo" | "gris";
type CycleColumnColors = { available: CycleColumnColor; committed: CycleColumnColor; evaluation: CycleColumnColor };

export type CreditHistorySourceRow = {
  client_id: string;
  client_name: string;
  customer_success_id: string | null;
  customer_success_name: string | null;
  billing: "paquetes" | "recurrencia";
  credits_remaining: number | null;
  contracted_credits: number;
  contracted_credits_period_months: number;
  flow_credits: number | null;
  current_cycle_start_at: string;
  current_cycle_end_at: string | null;
  is_active: boolean;
  observations: string | null;
  cycle_colors: CycleColumnColors | null;
};

export type CreditHistorySourceInitiative = {
  client_id: string;
  status: "backlog" | "planned" | "executing" | "completed";
  created_at: string;
  completed_at: string | null;
  credits: number;
};

export type CreditHistorySourceGrant = {
  client_id: string;
  granted_credits: number;
  used_credits: number;
  expired_credits: number;
  grant_date: string;
};

export type CreditHistoryReportRow = {
  clientId: string;
  clientName: string;
  customerSuccessId: string | null;
  customerSuccessName: string | null;
  billing: "paquetes" | "recurrencia";
  isActive: boolean;
  totalContractedCredits: number;
  flowCredits: number;
  availableCredits: number;
  flowWithContinuityCredits: number;
  evaluationCredits: number;
  committedCredits: number;
  completedCredits: number;
  cycleStartAt: string;
  cycleEndAt: string | null;
  observations: string | null;
  cycleColors: CycleColumnColors | null;
};

function getInitiativeCreditTotals(
  rows: CreditHistorySourceRow[],
  initiatives: CreditHistorySourceInitiative[],
) {
  const windowStartByClientId = new Map(rows.map((row) => [row.client_id, row.current_cycle_start_at]));
  const windowEndByClientId = new Map(rows.map((row) => [row.client_id, row.current_cycle_end_at]));
  const completedByClient = new Map<string, number>();
  const evaluationByClient = new Map<string, number>();
  const planningByClient = new Map<string, number>();
  const executingByClient = new Map<string, number>();

  initiatives.forEach((initiative) => {
    const credits = Number(initiative.credits) || 0;

    // "Completados" solo cuenta lo terminado durante el ciclo vigente (entre su inicio y su
    // fin, ambos inclusive) o en los últimos 30 días si no hay ciclo; no el acumulado histórico.
    if (initiative.status === "completed") {
      const windowStart = windowStartByClientId.get(initiative.client_id);
      const windowEnd = windowEndByClientId.get(initiative.client_id);
      const completedDate = initiative.completed_at?.slice(0, 10);
      if (
        windowStart &&
        completedDate &&
        completedDate >= windowStart &&
        (!windowEnd || completedDate <= windowEnd.slice(0, 10))
      ) {
        completedByClient.set(initiative.client_id, (completedByClient.get(initiative.client_id) ?? 0) + credits);
      }
      return;
    }

    // "En evaluación" usa la misma ventana: casos creados en el ciclo actual o últimos 30 días.
    if (initiative.status === "backlog") {
      const windowStart = windowStartByClientId.get(initiative.client_id);
      const createdDate = initiative.created_at.slice(0, 10);
      if (windowStart && createdDate >= windowStart) {
        evaluationByClient.set(initiative.client_id, (evaluationByClient.get(initiative.client_id) ?? 0) + credits);
      }
      return;
    }

    const byStatus =
      initiative.status === "planned"
        ? planningByClient
        : initiative.status === "executing"
          ? executingByClient
          : null;
    if (!byStatus) return;
    byStatus.set(initiative.client_id, (byStatus.get(initiative.client_id) ?? 0) + credits);
  });

  return { completedByClient, evaluationByClient, planningByClient, executingByClient };
}

export function buildCreditHistoryRows(
  rows: CreditHistorySourceRow[],
  initiatives: CreditHistorySourceInitiative[],
  creditGrants: CreditHistorySourceGrant[],
): CreditHistoryReportRow[] {
  const initiativeCreditTotals = getInitiativeCreditTotals(rows, initiatives);
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const grantedCreditsByClient = new Map<string, number>();
  // Saldo de grants cuyo ciclo aún no empieza (pagados por adelantado): no está disponible todavía.
  const futureRemainingByClient = new Map<string, number>();
  // Créditos que otorga el grant del ciclo vigente (el último que ya empezó).
  const currentGrantByClient = new Map<string, CreditHistorySourceGrant>();
  creditGrants.forEach((grant) => {
    grantedCreditsByClient.set(
      grant.client_id,
      (grantedCreditsByClient.get(grant.client_id) ?? 0) + Number(grant.granted_credits),
    );

    if (grant.grant_date > todayIsoDate) {
      const remaining = Math.max(
        0,
        Number(grant.granted_credits) - Number(grant.used_credits) - Number(grant.expired_credits),
      );
      futureRemainingByClient.set(
        grant.client_id,
        (futureRemainingByClient.get(grant.client_id) ?? 0) + remaining,
      );
      return;
    }

    const currentGrant = currentGrantByClient.get(grant.client_id);
    if (!currentGrant || grant.grant_date > currentGrant.grant_date) {
      currentGrantByClient.set(grant.client_id, grant);
    }
  });

  return rows
    .map((row) => {
      const hasFutureGrant = futureRemainingByClient.has(row.client_id);
      const availableCredits = Math.max(
        0,
        (Number(row.credits_remaining) || 0) - (futureRemainingByClient.get(row.client_id) ?? 0),
      );
      const planningCredits = initiativeCreditTotals.planningByClient.get(row.client_id) ?? 0;
      const executingCredits = initiativeCreditTotals.executingByClient.get(row.client_id) ?? 0;
      // contracted_credits es el total del plan completo (puede ser mensual, trimestral o
      // semestral); se divide entre su duración en meses para obtener el equivalente mensual.
      // Si ya pagó ciclos por adelantado se muestra el plan completo contratado.
      const recurringPeriodMonths = Math.max(1, row.contracted_credits_period_months || 1);
      const totalContractedCredits =
        row.billing === "paquetes"
          ? grantedCreditsByClient.get(row.client_id) ?? 0
          : hasFutureGrant
            ? row.contracted_credits
            : Math.round(row.contracted_credits / recurringPeriodMonths);

      // Caudal del cliente; sin caudal definido se toma el paquete contratado para este ciclo.
      // Con ciclos pagados por adelantado, lo que otorga el grant del ciclo vigente.
      const currentGrant = currentGrantByClient.get(row.client_id);
      const contractedFlowCredits =
        row.flow_credits
        ?? (hasFutureGrant && currentGrant ? Number(currentGrant.granted_credits) : totalContractedCredits);
      // Sin continuidad (cliente inactivo) no hay caudal real.
      const flowCredits = row.is_active ? contractedFlowCredits : 0;

      return {
        clientId: row.client_id,
        clientName: row.client_name,
        customerSuccessId: row.customer_success_id,
        customerSuccessName: row.customer_success_name,
        billing: row.billing,
        isActive: row.is_active,
        totalContractedCredits,
        flowCredits,
        availableCredits,
        // Simulación: si el cliente tuviera continuidad, conservaría lo disponible y
        // sumaría su caudal, aunque hoy no tenga continuidad.
        flowWithContinuityCredits: contractedFlowCredits + availableCredits,
        evaluationCredits: initiativeCreditTotals.evaluationByClient.get(row.client_id) ?? 0,
        committedCredits: planningCredits + executingCredits,
        completedCredits: initiativeCreditTotals.completedByClient.get(row.client_id) ?? 0,
        cycleStartAt: row.current_cycle_start_at,
        cycleEndAt: row.current_cycle_end_at,
        observations: row.observations,
        cycleColors: row.cycle_colors,
      };
    })
    // Un cliente inactivo sigue en Operaciones mientras tenga créditos
    // disponibles o comprometidos por ejecutar.
    .filter((row) => row.isActive || row.availableCredits > 0 || row.committedCredits > 0)
    .sort(
      (first, second) =>
        (first.customerSuccessName ?? "Sin asignar").localeCompare(
          second.customerSuccessName ?? "Sin asignar",
          "es",
        )
        || first.clientName.localeCompare(second.clientName, "es"),
    );
}
