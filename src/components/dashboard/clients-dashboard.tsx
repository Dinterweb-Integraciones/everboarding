"use client";

import { FolderKanban, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { ClientCard } from "@/components/dashboard/client-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClientSummary } from "@/lib/onboarding";
import { formatUserError, slugify } from "@/lib/utils";

type ClientsDashboardProps = {
  initialClients: ClientSummary[];
};

type FormState = {
  id?: string;
  name: string;
  description: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
};

export function ClientsDashboard({
  initialClients,
}: ClientsDashboardProps) {
  const [clients, setClients] = useState(initialClients);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = useMemo(() => {
    if (!clients.length) {
      return "Empieza creando tu primer cliente.";
    }

    return `${clients.length} cliente${clients.length === 1 ? "" : "s"} disponible${clients.length === 1 ? "" : "s"}.`;
  }, [clients.length]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      if (form.id) {
        const response = await fetch("/api/clients", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: form.id,
            name: form.name.trim(),
            description: form.description.trim() || null,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.message || "No fue posible actualizar el cliente.");
        }

        setClients((current) =>
          current.map((client) =>
            client.id === form.id ? { ...client, ...payload } : client,
          ),
        );
      } else {
        const baseSlug = slugify(form.name);
        const response = await fetch("/api/clients", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            slug: `${baseSlug || "cliente"}-${Date.now().toString(36)}`,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.message || "No fue posible crear el cliente.");
        }

        setClients((current) => [{ ...payload, access_role: "owner" }, ...current]);
      }

      setForm(emptyForm);
    } catch (caughtError) {
      setError(formatUserError(caughtError, "No fue posible guardar el cliente."));
    } finally {
      setIsSaving(false);
    }
  }

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
      <Card className="overflow-hidden">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <Badge className="bg-[var(--accent)]/10 text-[var(--accent)]">
              CRM + onboarding operativo
            </Badge>
            <h2 className="mt-4 text-3xl font-semibold text-slate-950">
              Administra clientes y entra al roadmap compartido.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{heading}</p>
            <div className="mt-5 flex items-center gap-3 text-sm text-slate-500">
              <FolderKanban className="h-4 w-4" />
              Gestiona el acceso del equipo y el onboarding desde un mismo lugar.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-100 bg-slate-50/80 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {form.id ? "Editar cliente" : "Nuevo cliente"}
              </h3>
              {form.id ? (
                <Button variant="ghost" onClick={() => setForm(emptyForm)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Nombre</span>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Acme Corp"
                required
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Descripcion</span>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Contexto del cliente, equipo, alcance o prioridad."
              />
            </label>
            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            <Button disabled={isSaving || !form.name.trim()} type="submit" className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {isSaving ? "Guardando..." : form.id ? "Actualizar cliente" : "Crear cliente"}
            </Button>
          </form>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            onEdit={(selectedClient) =>
              setForm({
                id: selectedClient.id,
                name: selectedClient.name,
                description: selectedClient.description ?? "",
              })
            }
            onDelete={handleDelete}
            canDelete={client.access_role === "owner"}
          />
        ))}
      </section>
    </div>
  );
}
