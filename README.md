# Everboarding

Aplicacion Next.js 16 + Supabase para autenticacion, clientes, onboarding operativo y comparticion con permisos.

## Variables de entorno

Usa `.env.example` como base:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# o tambien puedes usar:
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
```

## Base de datos

1. Crea un proyecto en Supabase.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Verifica que Email/Password este habilitado en `Authentication > Providers`.

## Desarrollo

```bash
npm install
npm run dev
```

## Despliegue

1. Define las variables de entorno en Vercel o tu hosting.
2. Usa `npm run build` para validar la compilacion.
3. Publica el directorio actual como proyecto Next.js.
