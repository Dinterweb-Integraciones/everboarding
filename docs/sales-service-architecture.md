# Sales App + Service App

## Objetivo

Mantener una sola base de datos y una sola lógica de negocio, pero con dos experiencias:

- `Sales App`: pública/semipública para vendedores internos y externos.
- `Service App`: autenticada para Customer Success.

## Flujo objetivo

1. Un vendedor crea una propuesta en `Sales App`.
2. La propuesta se guarda en `sales_proposals`.
3. Al guardar o actualizar, se sincroniza un deal en HubSpot.
4. Al presionar `Activar Plan`, se genera un checkout en Stripe.
5. Cuando Stripe confirma pago:
   - se marca la propuesta como pagada;
   - se mueve el deal de HubSpot a `won`;
   - se crea el `client` en Supabase;
   - se crea `onboarding_config`;
   - se clonan iniciativas y actividades al board de CS;
   - se registra el pago con la lógica actual de créditos/ciclos.

## Rutas nuevas

- `/sales/proposals/new`
- `/sales/proposals/[slug]`
- `POST /api/sales-proposals`
- `PUT /api/sales-proposals/[slug]`
- `POST /api/sales-proposals/[slug]/activate`

## Tabla nueva

- `sales_proposals`

Esta tabla guarda:

- datos del vendedor;
- datos del cliente;
- CSM asignado;
- condiciones comerciales;
- estado de la propuesta;
- ids de HubSpot/Stripe;
- snapshot completo del board comercial.

## Variables de entorno sugeridas

- `HUBSPOT_ACCESS_TOKEN`
- `HUBSPOT_SALES_PIPELINE_ID`
- `HUBSPOT_DEAL_STAGE_NEW_ID`
- `HUBSPOT_DEAL_STAGE_WON_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

## Pendientes siguientes

1. Asociar contactos/empresas de HubSpot, no solo deals.
2. Agregar control de acceso ligero para vendedores externos.
3. Agregar historial comercial de cambios en propuestas.
4. Crear tablero/listado de propuestas comerciales.
5. Vincular vendedor externo con identidad comercial propia.
