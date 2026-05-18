"use client";

import { useState } from "react";

import { ClientCard } from "@/components/dashboard/client-card";
import { ClientGameplanModal } from "@/components/dashboard/client-gameplan-modal";
import { ClientShareModal } from "@/components/dashboard/client-share-modal";
import { Card } from "@/components/ui/card";
import type { ClientSummary } from "@/lib/onboarding";

type ClientsDashboardProps = {
  initialClients: ClientSummary[];
};

export function ClientsDashboard({ initialClients }: ClientsDashboardProps) {
  const [clients, setClients] = useState(initialClients);
  const [error, setError] = useState<string | null>(null);
  const [sharingClient, setSharingClient] = useState<ClientSummary | null>(null);
  const [gameplanClient, setGameplanClient] = useState<ClientSummary | null>(null);

  async function handleDelete(client: ClientSummary) {
    const confirmed = window.confirm(
      `Se eliminara el cliente "${client.name}" y todo su onboarding. Esta accion no se puede deshacer.`,
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    const response = await fetch(`/api/clients?id=${client.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.message || "No fue posible eliminar el cliente.");
      return;
    }

    setClients((current) => current.filter((item) => item.id !== client.id));
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {error ? (
        <Card className="p-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.length ? (
          clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onDelete={handleDelete}
              onShare={setSharingClient}
              onGameplan={setGameplanClient}
              canDelete={client.access_role === "owner"}
              canShare={client.access_role === "owner"}
            />
          ))
        ) : (
          <Card className="p-6 md:col-span-2 xl:col-span-3">
            <h3 className="text-lg font-semibold text-slate-950">Aun no hay clientes en CS</h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              Cuando una venta se cierre y el cliente entre al flujo comercial, lo veras reflejado aqui para continuar su onboarding.
            </p>
          </Card>
        )}
      </section>

      {sharingClient ? (
        <ClientShareModal
          clientId={sharingClient.id}
          clientName={sharingClient.name}
          isOpen
          onClose={() => setSharingClient(null)}
        />
      ) : null}

      {gameplanClient ? (
        <ClientGameplanModal
          clientId={gameplanClient.id}
          clientName={gameplanClient.name}
          isOpen
          onClose={() => setGameplanClient(null)}
        />
      ) : null}
    </div>
  );
}
