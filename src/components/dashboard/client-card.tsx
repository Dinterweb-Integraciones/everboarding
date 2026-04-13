import Link from "next/link";
import { ArrowRight, CalendarDays, Pencil, Share2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ACCESS_ROLE_META } from "@/lib/constants";
import type { ClientSummary } from "@/lib/onboarding";
import { formatDate } from "@/lib/utils";

type ClientCardProps = {
  client: ClientSummary;
  onEdit: (client: ClientSummary) => void;
  onDelete: (client: ClientSummary) => void;
  onShare: (client: ClientSummary) => void;
  onGameplan: (client: ClientSummary) => void;
  canDelete: boolean;
  canShare: boolean;
};

export function ClientCard({
  client,
  onEdit,
  onDelete,
  onShare,
  onGameplan,
  canDelete,
  canShare,
}: ClientCardProps) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge className="bg-slate-100 text-slate-700">
            {ACCESS_ROLE_META[client.access_role].label}
          </Badge>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">{client.name}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {client.description || "Sin descripcion por ahora."}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-2 text-sm text-slate-500">
        <p>Creado: {formatDate(client.created_at)}</p>
        <p>Actualizado: {formatDate(client.updated_at)}</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/clients/${client.id}`} className="flex-1">
          <Button className="w-full">
            Abrir onboarding
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
        <Button variant="secondary" onClick={() => onEdit(client)}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar
        </Button>
        <Button variant="secondary" onClick={() => onGameplan(client)}>
          <CalendarDays className="mr-2 h-4 w-4" />
          Gameplan
        </Button>
        {canShare ? (
          <Button variant="secondary" onClick={() => onShare(client)}>
            <Share2 className="mr-2 h-4 w-4" />
            Compartir
          </Button>
        ) : null}
        {canDelete ? (
          <Button variant="danger" onClick={() => onDelete(client)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
