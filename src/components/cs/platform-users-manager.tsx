"use client";

import { Save, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  PLATFORM_ROLE_META,
  getPlatformRoleLabel,
  normalizePlatformEmail,
  type PlatformProfile,
  type PlatformRole,
  type PlatformUserInvite,
} from "@/lib/platform-access";
import { cn, formatDate, formatUserError } from "@/lib/utils";

type PlatformUsersManagerProps = {
  initialUsers: PlatformProfile[];
  initialPendingInvites: PlatformUserInvite[];
  currentUserId: string;
};

const roleOrder: PlatformRole[] = ["superadmin", "admin", "sales", "csm"];

type InviteResponsePayload = {
  user?: PlatformProfile | null;
  invite?: PlatformUserInvite | null;
  message?: string;
};

export function PlatformUsersManager({
  initialUsers,
  initialPendingInvites,
  currentUserId,
}: PlatformUsersManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [pendingInvites, setPendingInvites] = useState(initialPendingInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<PlatformRole>("sales");
  const [draftRoles, setDraftRoles] = useState<Record<string, PlatformRole>>(
    Object.fromEntries(
      initialUsers
        .filter((user) => user.platform_role)
        .map((user) => [user.id, user.platform_role as PlatformRole]),
    ),
  );
  const [isInviting, setIsInviting] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const summary = useMemo(() => {
    const active = users.filter((user) => user.is_platform_active).length;
    const superadmins = users.filter((user) => user.is_platform_active && user.platform_role === "superadmin").length;

    return {
      total: users.length,
      active,
      pending: pendingInvites.length,
      superadmins,
    };
  }, [pendingInvites.length, users]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((left, right) => {
      const leftRoleIndex = roleOrder.indexOf((left.platform_role ?? "csm") as PlatformRole);
      const rightRoleIndex = roleOrder.indexOf((right.platform_role ?? "csm") as PlatformRole);

      if (leftRoleIndex !== rightRoleIndex) {
        return leftRoleIndex - rightRoleIndex;
      }

      const leftName = (left.full_name || left.email).toLowerCase();
      const rightName = (right.full_name || right.email).toLowerCase();
      return leftName.localeCompare(rightName);
    });
  }, [users]);

  const sortedInvites = useMemo(() => {
    return [...pendingInvites].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
  }, [pendingInvites]);

  async function handleInvite() {
    const normalizedEmail = normalizePlatformEmail(inviteEmail);

    if (!normalizedEmail) {
      setFeedback({ tone: "error", message: "Ingresa el correo corporativo del usuario." });
      return;
    }

    setIsInviting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/cs/platform-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          fullName: inviteName.trim(),
          role: inviteRole,
        }),
      });

      const payload = (await response.json()) as InviteResponsePayload;
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos registrar la invitacion.");
      }

      const invitedUser = payload.user ?? null;
      const pendingInvite = payload.invite ?? null;

      if (invitedUser) {
        setUsers((current) => {
          const next = current.some((entry) => entry.id === invitedUser.id)
            ? current.map((entry) => (entry.id === invitedUser.id ? invitedUser : entry))
            : [...current, invitedUser];

          return next;
        });
        setDraftRoles((current) => ({
          ...current,
          [invitedUser.id]: invitedUser.platform_role as PlatformRole,
        }));
        setPendingInvites((current) =>
          current.filter((invite) => normalizePlatformEmail(invite.email) !== normalizedEmail),
        );
      }

      if (pendingInvite) {
        setPendingInvites((current) => {
          const exists = current.some((invite) => invite.id === pendingInvite.id);
          return exists
            ? current.map((invite) => (invite.id === pendingInvite.id ? pendingInvite : invite))
            : [pendingInvite, ...current.filter((invite) => normalizePlatformEmail(invite.email) !== normalizedEmail)];
        });
      }

      setInviteEmail("");
      setInviteName("");
      setInviteRole("sales");
      setFeedback({
        tone: "success",
        message: payload.message || "Acceso registrado correctamente.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos registrar la invitacion."),
      });
    } finally {
      setIsInviting(false);
    }
  }

  async function saveUserRole(profileId: string) {
    const nextRole = draftRoles[profileId];
    if (!nextRole) return;

    setSavingUserId(profileId);
    setFeedback(null);

    try {
      const response = await fetch(`/api/cs/platform-users/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });

      const payload = (await response.json()) as PlatformProfile & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos actualizar el rol.");
      }

      setUsers((current) => current.map((entry) => (entry.id === profileId ? payload : entry)));
      setDraftRoles((current) => ({
        ...current,
        [profileId]: payload.platform_role as PlatformRole,
      }));
      setFeedback({
        tone: "success",
        message: payload.message || "Rol actualizado.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos actualizar el rol."),
      });
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-none px-3 py-8 sm:px-4 lg:px-6 xl:px-8">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Superadmin
                </p>
                <h1 className="text-2xl font-black text-slate-900">Catalogo de usuarios y roles</h1>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {summary.total} usuarios
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                {summary.active} activos
              </span>
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold text-cyan-700">
                {summary.superadmins} superadmins
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                {summary.pending} invitaciones pendientes
              </span>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Desde aqui decides quien puede entrar a la plataforma y con que rol operativo lo hara.
            Si el usuario todavia no ha iniciado sesion, la invitacion queda pendiente y se activa
            automaticamente cuando entre con su correo corporativo.
          </p>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#ecfffb] text-[#00bda5]">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Invitar usuario</h2>
                <p className="text-sm text-slate-500">Habilita el correo y asigna su rol inicial.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Correo corporativo
                </label>
                <Input
                  type="email"
                  placeholder="usuario@dinterweb.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre
                </label>
                <Input
                  placeholder="Nombre del usuario"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Rol de plataforma
                </label>
                <Select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as PlatformRole)}
                >
                  {roleOrder.map((role) => (
                    <option key={role} value={role}>
                      {PLATFORM_ROLE_META[role].label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {PLATFORM_ROLE_META[inviteRole].label}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {PLATFORM_ROLE_META[inviteRole].description}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                El usuario debera entrar con Google usando su correo corporativo.
              </p>
              <Button onClick={handleInvite} disabled={isInviting}>
                <UserPlus className="mr-2 h-4 w-4" />
                {isInviting ? "Guardando..." : "Registrar acceso"}
              </Button>
            </div>
          </div>

          <div className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Invitaciones pendientes</h2>
                <p className="text-sm text-slate-500">Correos habilitados que aun no han ingresado.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {sortedInvites.length ? (
                sortedInvites.map((invite) => (
                  <article
                    key={invite.id}
                    className="rounded-[14px] border border-amber-200 bg-amber-50/70 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {invite.full_name || invite.email}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-600">{invite.email}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-amber-700">
                        {getPlatformRoleLabel(invite.role)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Registrada el {formatDate(invite.created_at)}
                    </p>
                  </article>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  No hay invitaciones pendientes en este momento.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">Usuarios activos</h2>
              <p className="mt-1 text-sm text-slate-500">
                Aqui puedes revisar quien ya tiene acceso y ajustar su rol.
              </p>
            </div>
          </div>

          <div className="mt-5 hidden overflow-hidden rounded-[16px] border border-slate-200 lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Usuario
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Rol actual
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Activado
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Ajustar rol
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedUsers.map((entry) => {
                    const selectedRole = draftRoles[entry.id] ?? (entry.platform_role as PlatformRole);
                    const hasChanges = selectedRole !== entry.platform_role;
                    const isCurrentUser = entry.id === currentUserId;

                    return (
                      <tr
                        key={entry.id}
                        className={cn(
                          "align-top transition",
                          hasChanges && "bg-[color-mix(in_oklab,var(--accent)_8%,white)]",
                        )}
                      >
                        <td className="px-4 py-4">
                          <div className="min-w-[220px]">
                            <p className="font-bold text-slate-900">
                              {entry.full_name || entry.email}
                              {isCurrentUser ? " · Tu cuenta" : ""}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">{entry.email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-3 py-1 text-[11px] font-bold",
                              entry.is_platform_active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {entry.is_platform_active ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                          {getPlatformRoleLabel(entry.platform_role)}
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                          {entry.platform_activated_at ? formatDate(entry.platform_activated_at) : "Pendiente"}
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-[190px]">
                            <Select
                              value={selectedRole}
                              onChange={(event) =>
                                setDraftRoles((current) => ({
                                  ...current,
                                  [entry.id]: event.target.value as PlatformRole,
                                }))
                              }
                            >
                              {roleOrder.map((role) => (
                                <option key={`${entry.id}-${role}`} value={role}>
                                  {PLATFORM_ROLE_META[role].label}
                                </option>
                              ))}
                            </Select>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-[150px] justify-end">
                            <Button
                              onClick={() => saveUserRole(entry.id)}
                              disabled={!hasChanges || savingUserId === entry.id}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {savingUserId === entry.id ? "Guardando..." : "Guardar"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 space-y-4 lg:hidden">
            {sortedUsers.map((entry) => {
              const selectedRole = draftRoles[entry.id] ?? (entry.platform_role as PlatformRole);
              const hasChanges = selectedRole !== entry.platform_role;
              const isCurrentUser = entry.id === currentUserId;

              return (
                <article
                  key={entry.id}
                  className={cn(
                    "rounded-[18px] border bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.05)] transition",
                    hasChanges ? "border-[var(--accent)]" : "border-slate-200",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-slate-900">
                        {entry.full_name || entry.email}
                        {isCurrentUser ? " · Tu cuenta" : ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{entry.email}</p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-3 py-1 text-[11px] font-bold",
                        entry.is_platform_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {entry.is_platform_active ? "Activo" : "Inactivo"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4">
                    <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Rol actual
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {getPlatformRoleLabel(entry.platform_role)}
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Ajustar rol
                      </label>
                      <Select
                        value={selectedRole}
                        onChange={(event) =>
                          setDraftRoles((current) => ({
                            ...current,
                            [entry.id]: event.target.value as PlatformRole,
                          }))
                        }
                      >
                        {roleOrder.map((role) => (
                          <option key={`${entry.id}-mobile-${role}`} value={role}>
                            {PLATFORM_ROLE_META[role].label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={() => saveUserRole(entry.id)}
                      disabled={!hasChanges || savingUserId === entry.id}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savingUserId === entry.id ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {feedback ? (
        <FeedbackToast
          feedback={feedback}
          onClose={() => setFeedback(null)}
        />
      ) : null}
    </>
  );
}
