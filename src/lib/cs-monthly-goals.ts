// Metas mensuales de créditos por Customer Success y su avance: créditos de casos de uso
// completados dentro del mes calendario. Los meses se identifican como "YYYY-MM" (UTC, igual que
// el resto de fechas de Informes); en la base de datos se guardan como el primer día del mes.

export type MonthlyGoalRow = {
  customer_success_id: string;
  month: string;
  goal_credits: number;
};

export type MonthlyGoalProgressEntry = {
  csId: string;
  csName: string;
  completedCredits: number;
  // Null si el CS no tiene meta definida para ese mes.
  goalCredits: number | null;
};

export type MonthlyGoalProgress = {
  month: string;
  // Suma de todos los CS: completados de todos sobre la suma de las metas definidas.
  overall: { completedCredits: number; goalCredits: number };
  customerSuccess: MonthlyGoalProgressEntry[];
};

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

export function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function monthKeyToDate(monthKey: string) {
  return `${monthKey}-01`;
}

// Los `count` meses que terminan en el mes actual, del más reciente al más antiguo.
export function getRecentMonthKeys(count: number) {
  const [year, month] = getCurrentMonthKey().split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function formatShortMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function buildMonthlyGoalProgress({
  months,
  goals,
  completedInitiatives,
  customerSuccessIdByClientId,
  customerSuccessNameById,
}: {
  months: string[];
  goals: MonthlyGoalRow[];
  completedInitiatives: Array<{ client_id: string; completed_at: string | null; credits: number }>;
  customerSuccessIdByClientId: Map<string, string | null>;
  customerSuccessNameById: Map<string, string>;
}): MonthlyGoalProgress[] {
  const goalByCsMonth = new Map(
    goals.map((goal) => [`${goal.customer_success_id}:${goal.month.slice(0, 7)}`, Number(goal.goal_credits)]),
  );
  // Un caso cuenta para el CS asignado hoy al cliente, en el mes calendario en que se completó.
  const completedByCsMonth = new Map<string, number>();
  completedInitiatives.forEach((initiative) => {
    const csId = customerSuccessIdByClientId.get(initiative.client_id);
    const month = initiative.completed_at?.slice(0, 7);
    if (!csId || !month) return;
    const key = `${csId}:${month}`;
    completedByCsMonth.set(key, (completedByCsMonth.get(key) ?? 0) + (Number(initiative.credits) || 0));
  });

  return months.map((month) => {
    const customerSuccess = [...customerSuccessNameById.entries()]
      .map(([csId, csName]) => ({
        csId,
        csName,
        completedCredits: completedByCsMonth.get(`${csId}:${month}`) ?? 0,
        goalCredits: goalByCsMonth.get(`${csId}:${month}`) ?? null,
      }))
      // Sin meta ni avance en el mes no hay nada que mostrar.
      .filter((entry) => entry.goalCredits !== null || entry.completedCredits > 0)
      .sort((first, second) => first.csName.localeCompare(second.csName, "es"));

    return {
      month,
      overall: {
        completedCredits: customerSuccess.reduce((sum, entry) => sum + entry.completedCredits, 0),
        goalCredits: customerSuccess.reduce((sum, entry) => sum + (entry.goalCredits ?? 0), 0),
      },
      customerSuccess,
    };
  });
}
