"use client";

import { ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PROFILE_ROLE_META } from "@/lib/constants";
import type {
  ClientAccessRole,
  ClientMemberRecord,
  ClientProfileRole,
} from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatUserError } from "@/lib/utils";

type SharePanelProps = {
  clientId: string;
  accessRole: ClientAccessRole;
  members: ClientMemberRecord[];
  onMembersChange: (members: ClientMemberRecord[]) => void;
  onError: (message: string | null) => void;
  onSuccess: (message: string) => void;
};

export function SharePanel({
  clientId,
  accessRole,
  members,
  onMembersChange,
  onError,
  onSuccess,
}: SharePanelProps) {
  const supabase = createSupabaseBrowserClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [inviteProfileRole, setInviteProfileRole] = useState<ClientProfileRole>("client");
  const [isInviting, setIsInviting] = useState(false);

  function resolveProfileRole(value: string | null | undefined): ClientProfileRole {
    if (value && value in PROFILE_ROLE_META) {
      return value as ClientProfileRole;
    }

    return "stakeholder";
  }

  function resolveAccessRole(value: string | null | undefined): "viewer" | "editor" {
    return value === "editor" ? "editor" : "viewer";
  }

  if (accessRole !== "owner") {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Compartir onboarding</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Solo el propietario del cliente puede generar enlaces y administrar permisos.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  async function inviteSystemUser() {
    onError(null);

    if (!inviteEmail.trim()) {
      onError("Escribe el correo del usuario que ya existe en el sistema.");
      return;
    }

    setIsInviting(true);

    try {
      const { data, error } = await supabase.rpc("add_client_member_by_email", {
        p_client_id: clientId,
        p_email: inviteEmail.trim(),
        p_access_role: inviteRole,
        p_profile_role: inviteProfileRole,
      });

      if (error) {
        throw error;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", data.user_id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      const nextMember: ClientMemberRecord = {
        ...data,
        email: profile?.email ?? inviteEmail.trim(),
        full_name: profile?.full_name ?? null,
      };

      onMembersChange([
        nextMember,
        ...members.filter((member) => member.user_id !== nextMember.user_id),
      ]);
      setInviteEmail("");
      onSuccess("Usuario agregado al onboarding correctamente.");
    } catch (caughtError) {
      onError(
        formatUserError(caughtError, "No fue posible compartir con ese usuario."),
      );
    } finally {
      setIsInviting(false);
    }
  }

  async function updateMemberAccessRole(
    member: ClientMemberRecord,
    nextRole: "viewer" | "editor",
  ) {
    onError(null);

    const { data, error } = await supabase
      .from("client_members")
      .update({
        access_role: nextRole,
      })
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id)
      .select("*")
      .single();

    if (error) {
      onError(formatUserError(error.message, "No fue posible actualizar el perfil."));
      return;
    }

    onMembersChange(
      members.map((currentMember) =>
        currentMember.user_id === member.user_id
          ? { ...currentMember, ...data }
          : currentMember,
      ),
    );
    onSuccess("Permiso actualizado.");
  }

  async function updateMemberProfileRole(
    member: ClientMemberRecord,
    nextRole: ClientProfileRole,
  ) {
    onError(null);

    const { data, error } = await supabase
      .from("client_members")
      .update({
        profile_role: nextRole,
      })
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id)
      .select("*")
      .single();

    if (error) {
      onError(formatUserError(error.message, "No fue posible remover el acceso."));
      return;
    }

    onMembersChange(
      members.map((currentMember) =>
        currentMember.user_id === member.user_id
          ? { ...currentMember, ...data }
          : currentMember,
      ),
    );
    onSuccess("Perfil actualizado.");
  }

  async function removeMember(member: ClientMemberRecord) {
    onError(null);
    const confirmed = window.confirm(
      `Se quitara el acceso de ${member.full_name || member.email || "este usuario"}.`,
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("client_members")
      .delete()
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id);

    if (error) {
      onError(formatUserError(error.message, "No fue posible revocar el enlace."));
      return;
    }

    onMembersChange(members.filter((currentMember) => currentMember.user_id !== member.user_id));
    onSuccess("Acceso removido.");
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div>
          <h4 className="text-base font-semibold text-slate-900">Agregar usuario del sistema</h4>
          <p className="mt-2 text-sm text-slate-600">
            Comparte este onboarding con alguien que ya tenga cuenta registrada.
          </p>
        </div>

        <div className="mt-4">
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Correo del usuario</span>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="usuario@empresa.com"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Permiso</span>
              <Select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as "viewer" | "editor")}
              >
                <option value="viewer">Solo lectura</option>
                <option value="editor">Lectura y escritura</option>
              </Select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Perfil</span>
              <Select
                value={inviteProfileRole}
                onChange={(event) => setInviteProfileRole(event.target.value as ClientProfileRole)}
              >
                {Object.entries(PROFILE_ROLE_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="mt-4">
            <Button className="w-full md:w-auto" onClick={inviteSystemUser} disabled={isInviting}>
              {isInviting ? "Agregando..." : "Agregar usuario"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-lg font-semibold text-slate-900">Usuarios con acceso</h3>
        <div className="mt-4 space-y-3">
          {members.length ? (
            members.map((member) => (
              <div
                key={member.user_id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {member.full_name || "Usuario compartido"}
                  </p>
                  <p className="text-sm text-slate-500">{member.email || "Email no disponible"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={resolveAccessRole(member.access_role)}
                    onChange={(event) =>
                      updateMemberAccessRole(member, event.target.value as "viewer" | "editor")
                    }
                    className="min-w-40"
                  >
                    <option value="viewer">Solo lectura</option>
                    <option value="editor">Editor</option>
                  </Select>
                  <Select
                    value={resolveProfileRole(member.profile_role)}
                    onChange={(event) =>
                      updateMemberProfileRole(
                        member,
                        event.target.value as ClientProfileRole,
                      )
                    }
                    className="min-w-40"
                  >
                    {Object.entries(PROFILE_ROLE_META).map(([value, meta]) => (
                      <option key={value} value={value}>
                        {meta.label}
                      </option>
                    ))}
                  </Select>
                  <Button variant="danger" onClick={() => removeMember(member)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Quitar
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">
              Aun no hay usuarios adicionales con acceso a este cliente.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
