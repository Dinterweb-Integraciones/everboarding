// Cálculo del informe de Operaciones: créditos por cliente en su ciclo vigente (contratados,
// caudal, disponibles, comprometidos, completados, etc.).
//
// Disponibles, Comprometidos y Completados solo cuentan créditos que pasaron a esa etapa dentro de
// la ventana del cliente: su ciclo vigente si es recurrente, o los últimos 30 días si es de
// paquetes. En Evaluación es la excepción: cuenta todo lo que hoy está en evaluación.

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
  id: string;
  client_id: string;
  title: string;
  status: "backlog" | "planned" | "executing" | "completed";
  created_at: string;
  // Fecha en que el caso entró a su etapa actual (Planificado / En ejecución).
  stage_entered_at: string;
  completed_at: string | null;
  credits: number;
};

export type CreditHistorySourceGrant = {
  client_id: string;
  granted_credits: number;
  used_credits: number;
  expired_credits: number;
  grant_date: string;
  expires_at: string;
};

// Detalle de lo que suma (o queda fuera de) cada columna, para justificar la cifra.
export type CreditBreakdownItem = {
  key: string;
  title: string;
  stage: string;
  // Fecha que decide si entra en la ventana (o la de creación, en evaluación).
  date: string | null;
  dateLabel: string;
  // Solo en Disponibles: vencimiento del grant.
  expiresAt?: string;
  credits: number;
  // false: se muestra como referencia, pero quedó fuera de la ventana y no suma.
  included: boolean;
};

export type CreditBreakdownKey = "evaluation" | "available" | "committed" | "completed";

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
  // Ventana con la que se midieron Disponibles, Comprometido y Completados.
  windowStart: string;
  windowEnd: string | null;
  // Saldo real del cliente; si es menor que lo otorgado en la ventana, Disponibles se limita a él.
  currentBalance: number;
  breakdown: Record<CreditBreakdownKey, CreditBreakdownItem[]>;
  observations: string | null;
  cycleColors: CycleColumnColors | null;
};

type ReportWindow = { start: string; end: string | null };

const STAGE_LABELS: Record<CreditHistorySourceInitiative["status"], string> = {
  backlog: "En evaluación",
  planned: "Planificado",
  executing: "En ejecución",
  completed: "Completado",
};

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Ventana en la que se miden las etapas: el ciclo vigente para recurrentes y los últimos
// 30 días para paquetes. Fechas ISO (YYYY-MM-DD), ambos extremos inclusivos.
function getReportWindow(row: CreditHistorySourceRow): ReportWindow {
  if (row.billing === "paquetes") return { start: isoDateDaysAgo(30), end: null };
  return {
    start: row.current_cycle_start_at.slice(0, 10),
    end: row.current_cycle_end_at?.slice(0, 10) ?? null,
  };
}

function isWithinWindow(value: string | null | undefined, window: ReportWindow | undefined) {
  const date = value?.slice(0, 10);
  return Boolean(window && date && date >= window.start && (!window.end || date <= window.end));
}

function sumIncluded(items: CreditBreakdownItem[] | undefined) {
  return (items ?? []).reduce((sum, item) => (item.included ? sum + item.credits : sum), 0);
}

function emptyBreakdown(): Record<CreditBreakdownKey, CreditBreakdownItem[]> {
  return { evaluation: [], available: [], committed: [], completed: [] };
}

export function buildCreditHistoryRows(
  rows: CreditHistorySourceRow[],
  initiatives: CreditHistorySourceInitiative[],
  creditGrants: CreditHistorySourceGrant[],
): CreditHistoryReportRow[] {
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const windowByClientId = new Map(rows.map((row) => [row.client_id, getReportWindow(row)]));
  const breakdownByClient = new Map<string, Record<CreditBreakdownKey, CreditBreakdownItem[]>>();
  const getBreakdown = (clientId: string) => {
    let breakdown = breakdownByClient.get(clientId);
    if (!breakdown) {
      breakdown = emptyBreakdown();
      breakdownByClient.set(clientId, breakdown);
    }
    return breakdown;
  };
  // Clientes con casos Planificados o En ejecución, sin importar cuándo entraron a esa etapa.
  const clientsWithCommittedWork = new Set<string>();

  initiatives.forEach((initiative) => {
    const credits = Number(initiative.credits) || 0;
    const window = windowByClientId.get(initiative.client_id);
    const base = {
      key: initiative.id,
      title: initiative.title,
      stage: STAGE_LABELS[initiative.status],
      credits,
    };

    // "Completados" solo cuenta lo terminado dentro de la ventana; no el acumulado histórico.
    if (initiative.status === "completed") {
      if (isWithinWindow(initiative.completed_at, window)) {
        getBreakdown(initiative.client_id).completed.push({
          ...base,
          date: initiative.completed_at,
          dateLabel: "Completado el",
          included: true,
        });
      }
      return;
    }

    // "En evaluación" no sigue la ventana: cuenta todo lo que hoy está en evaluación.
    if (initiative.status === "backlog") {
      getBreakdown(initiative.client_id).evaluation.push({
        ...base,
        date: initiative.created_at,
        dateLabel: "Creado el",
        included: true,
      });
      return;
    }

    // "Comprometido" solo cuenta los casos que pasaron a Planificado / En ejecución en la ventana;
    // los demás se listan como referencia.
    clientsWithCommittedWork.add(initiative.client_id);
    getBreakdown(initiative.client_id).committed.push({
      ...base,
      date: initiative.stage_entered_at,
      dateLabel: `Pasó a ${STAGE_LABELS[initiative.status]} el`,
      included: isWithinWindow(initiative.stage_entered_at, window),
    });
  });

  const grantedCreditsByClient = new Map<string, number>();
  // Saldo de grants cuyo ciclo aún no empieza (pagados por adelantado): no está disponible todavía.
  const futureRemainingByClient = new Map<string, number>();
  // Créditos que otorga el grant del ciclo vigente (el último que ya empezó).
  const currentGrantByClient = new Map<string, CreditHistorySourceGrant>();
  creditGrants.forEach((grant, index) => {
    grantedCreditsByClient.set(
      grant.client_id,
      (grantedCreditsByClient.get(grant.client_id) ?? 0) + Number(grant.granted_credits),
    );
    const remaining = Math.max(
      0,
      Number(grant.granted_credits) - Number(grant.used_credits) - Number(grant.expired_credits),
    );

    if (grant.grant_date > todayIsoDate) {
      futureRemainingByClient.set(
        grant.client_id,
        (futureRemainingByClient.get(grant.client_id) ?? 0) + remaining,
      );
      return;
    }

    // Disponibles: saldo vigente de los grants otorgados en la ventana. Los grants vigentes de
    // antes de la ventana se listan como referencia.
    if (grant.expires_at >= todayIsoDate && remaining > 0) {
      getBreakdown(grant.client_id).available.push({
        key: `grant-${index}`,
        title: `Créditos otorgados (${Number(grant.granted_credits)} CR)`,
        stage: "Saldo vigente",
        expiresAt: grant.expires_at,
        date: grant.grant_date,
        dateLabel: "Otorgados el",
        credits: remaining,
        included: isWithinWindow(grant.grant_date, windowByClientId.get(grant.client_id)),
      });
    }

    const currentGrant = currentGrantByClient.get(grant.client_id);
    if (!currentGrant || grant.grant_date > currentGrant.grant_date) {
      currentGrantByClient.set(grant.client_id, grant);
    }
  });

  // Saldo real del cliente, sin contar lo de ciclos que aún no empiezan.
  const getCurrentBalance = (row: CreditHistorySourceRow) =>
    Math.max(
      0,
      (Number(row.credits_remaining) || 0) - (futureRemainingByClient.get(row.client_id) ?? 0),
    );

  return rows
    // Un cliente inactivo sigue en Operaciones mientras tenga créditos disponibles o
    // comprometidos por ejecutar, aunque hayan entrado antes de la ventana.
    .filter(
      (row) =>
        row.is_active ||
        getCurrentBalance(row) > 0 ||
        clientsWithCommittedWork.has(row.client_id),
    )
    .map((row) => {
      const breakdown = breakdownByClient.get(row.client_id) ?? emptyBreakdown();
      const byDate = (first: CreditBreakdownItem, second: CreditBreakdownItem) =>
        Number(second.included) - Number(first.included) ||
        (second.date ?? "").localeCompare(first.date ?? "");
      (Object.keys(breakdown) as CreditBreakdownKey[]).forEach((key) => breakdown[key].sort(byDate));

      const window = windowByClientId.get(row.client_id) ?? getReportWindow(row);
      const currentBalance = getCurrentBalance(row);
      const hasFutureGrant = futureRemainingByClient.has(row.client_id);
      // Solo lo que entró como disponible en la ventana, sin superar el saldo real del cliente.
      const availableCredits = Math.min(sumIncluded(breakdown.available), currentBalance);
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
        evaluationCredits: sumIncluded(breakdown.evaluation),
        committedCredits: sumIncluded(breakdown.committed),
        completedCredits: sumIncluded(breakdown.completed),
        cycleStartAt: row.current_cycle_start_at,
        cycleEndAt: row.current_cycle_end_at,
        windowStart: window.start,
        windowEnd: window.end,
        currentBalance,
        breakdown,
        observations: row.observations,
        cycleColors: row.cycle_colors,
      };
    })
    .sort(
      (first, second) =>
        (first.customerSuccessName ?? "Sin asignar").localeCompare(
          second.customerSuccessName ?? "Sin asignar",
          "es",
        )
        || first.clientName.localeCompare(second.clientName, "es"),
    );
}
