# RMSCore — PROMPT A: Fix Inmediato — Extras no deben pagarse sin aprobación

## CONTEXTO

El archivo `server/payroll.ts` tiene un error introducido recientemente:
las horas extra se pagan aunque estén pendientes de aprobación.
Este fix revierte ese comportamiento en una sola línea.

---

## EL ÚNICO CAMBIO

Abrir `server/payroll.ts`.

Localizar el bloque que dice (aproximadamente líneas 316–320):

```typescript
  let overtimePaidMinutes = overtimeCalculatedMinutes;
  if (overtimeRequiresApproval && overtimeCalculatedMinutes > 0) {
    flags.push("OVERTIME_PENDIENTE_APROBACION");
    // NOTA: overtimePaidMinutes NO se pone en 0 ...
  }
```

**Reemplazar por:**

```typescript
  let overtimePaidMinutes = overtimeCalculatedMinutes;
  if (overtimeRequiresApproval && overtimeCalculatedMinutes > 0) {
    overtimePaidMinutes = 0;   // no se paga hasta aprobación del manager
    flags.push("OVERTIME_PENDIENTE_APROBACION");
  }
```

Compilar: `npx tsc --noEmit` — debe pasar sin errores.

Verificar en la UI de planilla que todos los empleados con flag
"OT pendiente" muestren Extra (Pag) = 0 y su Pago Base no incluya
el monto de extras.

---
---

# RMSCore — PROMPT B: Feature — Flujo de Aprobación de Horas Extra

## OBJETIVO

Permitir al manager aprobar o rechazar horas extra por día individual
o todas las de un empleado en el período, desde el detalle expandido
de la planilla. Las extras rechazadas se registran con razón
obligatoria y nunca se borran.

---

## PASO 1 — Nueva tabla en la base de datos

Abrir `shared/schema.ts`.

Agregar la siguiente tabla al final, junto a las demás tablas de HR:

```typescript
export const hrOvertimeApprovals = pgTable("hr_overtime_approvals", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  businessDate: text("business_date").notNull(),  // "YYYY-MM-DD"
  overtimeMinutes: integer("overtime_minutes").notNull(),
  status: text("status").notNull().default("PENDING"),
  // PENDING | APPROVED | REJECTED
  approvedBy: integer("approved_by"),             // userId del manager
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

Agregar constraint único para evitar duplicados:
```typescript
// dentro de la definición de la tabla, como tercer argumento:
(t) => ({
  uniqueEmployeeDate: unique().on(t.employeeId, t.businessDate),
})
```

Ejecutar `npx drizzle-kit push` para crear la tabla en la base de datos.
Si drizzle-kit no está disponible, ejecutar directamente:
```sql
CREATE TABLE IF NOT EXISTS hr_overtime_approvals (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  overtime_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by INTEGER,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, business_date)
);
```

---

## PASO 2 — Endpoints en el servidor

Abrir el archivo de rutas de HR (probablemente `server/routes.ts` o
`server/hr-routes.ts` — buscar donde están las rutas `/api/hr/`).

Agregar estos 4 endpoints al final de las rutas de HR:

```typescript
// ==================== HR: OVERTIME APPROVALS ====================

// GET — obtener aprobaciones para un rango (para cargar estado en planilla)
app.get("/api/hr/overtime-approvals", requirePermission("MODULE_HR_VIEW"), async (req, res) => {
  try {
    const { dateFrom, dateTo, employeeId } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom y dateTo son requeridos" });
    }
    let query = db
      .select()
      .from(hrOvertimeApprovals)
      .where(
        and(
          gte(hrOvertimeApprovals.businessDate, String(dateFrom)),
          lte(hrOvertimeApprovals.businessDate, String(dateTo))
        )
      );
    if (employeeId) {
      query = query.where(eq(hrOvertimeApprovals.employeeId, Number(employeeId)));
    }
    const rows = await query;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// POST — crear o actualizar aprobación individual (un día)
app.post("/api/hr/overtime-approvals", requirePermission("MODULE_HR_VIEW"), async (req, res) => {
  try {
    const { employeeId, businessDate, status, rejectionReason, overtimeMinutes } = req.body;
    const managerId = req.session.userId!;

    if (!employeeId || !businessDate || !status || !overtimeMinutes) {
      return res.status(400).json({ message: "employeeId, businessDate, status y overtimeMinutes son requeridos" });
    }
    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "status debe ser APPROVED o REJECTED" });
    }
    if (status === "REJECTED" && !rejectionReason?.trim()) {
      return res.status(400).json({ message: "La razón de rechazo es obligatoria" });
    }

    const existing = await db
      .select()
      .from(hrOvertimeApprovals)
      .where(
        and(
          eq(hrOvertimeApprovals.employeeId, Number(employeeId)),
          eq(hrOvertimeApprovals.businessDate, String(businessDate))
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(hrOvertimeApprovals)
        .set({
          status,
          approvedBy: managerId,
          approvedAt: new Date(),
          rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
          overtimeMinutes: Number(overtimeMinutes),
          updatedAt: new Date(),
        })
        .where(eq(hrOvertimeApprovals.id, existing[0].id));
    } else {
      await db.insert(hrOvertimeApprovals).values({
        employeeId: Number(employeeId),
        businessDate: String(businessDate),
        overtimeMinutes: Number(overtimeMinutes),
        status,
        approvedBy: managerId,
        approvedAt: new Date(),
        rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
      });
    }

    await storage.createAuditEvent({
      actorType: "USER",
      actorUserId: managerId,
      action: status === "APPROVED" ? "OVERTIME_APPROVED" : "OVERTIME_REJECTED",
      entityType: "hr_overtime_approval",
      entityId: Number(employeeId),
      metadata: { businessDate, overtimeMinutes, rejectionReason: rejectionReason || null },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// POST — aprobar/rechazar TODAS las extras pendientes de un empleado en un rango
app.post("/api/hr/overtime-approvals/bulk", requirePermission("MODULE_HR_VIEW"), async (req, res) => {
  try {
    const { employeeId, dateFrom, dateTo, status, rejectionReason, days } = req.body;
    // days: [{ businessDate, overtimeMinutes }]
    const managerId = req.session.userId!;

    if (!employeeId || !status || !days?.length) {
      return res.status(400).json({ message: "employeeId, status y days son requeridos" });
    }
    if (status === "REJECTED" && !rejectionReason?.trim()) {
      return res.status(400).json({ message: "La razón de rechazo es obligatoria para rechazos masivos" });
    }

    for (const day of days) {
      const existing = await db
        .select()
        .from(hrOvertimeApprovals)
        .where(
          and(
            eq(hrOvertimeApprovals.employeeId, Number(employeeId)),
            eq(hrOvertimeApprovals.businessDate, String(day.businessDate))
          )
        )
        .limit(1);

      const values = {
        status,
        approvedBy: managerId,
        approvedAt: new Date(),
        rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
        overtimeMinutes: Number(day.overtimeMinutes),
        updatedAt: new Date(),
      };

      if (existing.length > 0) {
        await db.update(hrOvertimeApprovals).set(values).where(eq(hrOvertimeApprovals.id, existing[0].id));
      } else {
        await db.insert(hrOvertimeApprovals).values({
          employeeId: Number(employeeId),
          businessDate: String(day.businessDate),
          ...values,
        });
      }
    }

    await storage.createAuditEvent({
      actorType: "USER",
      actorUserId: managerId,
      action: status === "APPROVED" ? "OVERTIME_BULK_APPROVED" : "OVERTIME_BULK_REJECTED",
      entityType: "hr_overtime_approval",
      entityId: Number(employeeId),
      metadata: { dateFrom, dateTo, count: days.length, rejectionReason: rejectionReason || null },
    });

    res.json({ ok: true, count: days.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

Asegurarse de importar `hrOvertimeApprovals` desde `shared/schema.ts`
al inicio del archivo de rutas donde se agregaron los endpoints.

---

## PASO 3 — Modificar `computeRangePayroll` para usar aprobaciones

Abrir `server/payroll.ts`.

Modificar la interfaz de entrada de `computeRangePayroll` para recibir
el mapa de aprobaciones:

Localizar:
```typescript
export function computeRangePayroll(args: {
  employees: ...
  schedulesMap: ...
  punchesMap: ...
  extrasMap: ...
  servicePoolMap: ...
  extraTypesKindMap: ...
  dateFrom: string;
  dateTo: string;
  hrConfig: HrConfig;
```

Agregar el campo opcional al final de la interfaz:
```typescript
  overtimeApprovalsMap?: Record<string, "APPROVED" | "REJECTED" | "PENDING">;
  // clave: "${employeeId}_${businessDate}" → estado
```

Dentro de `computeRangePayroll`, localizar donde se acumula
`totalOvertimePaidMin` y `overtimePay` por día (~línea 636–646):

```typescript
      totalOvertimeCalcMin += daily.overtimeCalculatedMinutes;
      totalOvertimePaidMin += daily.overtimePaidMinutes;
```

Reemplazar por:

```typescript
      totalOvertimeCalcMin += daily.overtimeCalculatedMinutes;

      // Verificar aprobación si existe el mapa
      let overtimePaidThisDay = daily.overtimePaidMinutes;
      if (args.overtimeApprovalsMap && daily.overtimeCalculatedMinutes > 0) {
        const approvalKey = `${emp.id}_${dateStr}`;
        const approvalStatus = args.overtimeApprovalsMap[approvalKey];
        if (approvalStatus === "APPROVED") {
          overtimePaidThisDay = daily.overtimeCalculatedMinutes; // aprobada: pagar todo
        } else if (approvalStatus === "REJECTED") {
          overtimePaidThisDay = 0; // rechazada: no pagar
        } else {
          overtimePaidThisDay = 0; // PENDING o sin registro: no pagar
        }
      }
      totalOvertimePaidMin += overtimePaidThisDay;
```

También actualizar los acumuladores de pago para usar
`overtimePaidThisDay` en lugar del valor del daily:

```typescript
      const jornadaHoras = Number(hrConfig.overtimeDailyThresholdHours) || 8;
      const multiplier = Number(hrConfig.overtimeMultiplier) || 1.5;
      const hourlyRate = dailyRate / jornadaHoras;
      const overtimePayThisDay = round2((overtimePaidThisDay / 60) * hourlyRate * multiplier);
      const normalPayThisDay = daily.normalPay;

      normalPay += normalPayThisDay;
      overtimePay += overtimePayThisDay;
      basePayTotal += round2(normalPayThisDay + overtimePayThisDay);
```

---

## PASO 4 — Modificar la carga de planilla en el servidor

Buscar el endpoint que sirve los datos de planilla al frontend,
probablemente `GET /api/hr/payroll` o similar en `server/routes.ts`.

En ese endpoint, después de obtener `hrConfig`, agregar la carga de
aprobaciones y construir el mapa:

```typescript
    // Cargar aprobaciones del período
    const approvalRows = await db
      .select()
      .from(hrOvertimeApprovals)
      .where(
        and(
          gte(hrOvertimeApprovals.businessDate, dateFrom),
          lte(hrOvertimeApprovals.businessDate, dateTo)
        )
      );

    const overtimeApprovalsMap: Record<string, "APPROVED" | "REJECTED" | "PENDING"> = {};
    for (const row of approvalRows) {
      const key = `${row.employeeId}_${row.businessDate}`;
      overtimeApprovalsMap[key] = row.status as "APPROVED" | "REJECTED" | "PENDING";
    }
```

Pasar `overtimeApprovalsMap` a `computeRangePayroll`:
```typescript
    const results = computeRangePayroll({
      // ... args existentes ...
      overtimeApprovalsMap,
    });
```

---

## PASO 5 — UI: botones de aprobación en el detalle del empleado

Abrir `client/src/pages/hr/reports.tsx` (o el archivo donde vive
la tabla de planilla con las filas expandibles).

**5a — Cargar aprobaciones al montar el componente:**

Al cargar la planilla con `useQuery`, agregar una segunda query para
las aprobaciones del mismo período:

```typescript
const { data: approvals, refetch: refetchApprovals } = useQuery({
  queryKey: ["/api/hr/overtime-approvals", { dateFrom, dateTo }],
  queryFn: () =>
    fetch(`/api/hr/overtime-approvals?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json()),
  enabled: !!dateFrom && !!dateTo,
});

// Construir mapa local para lookup rápido
const approvalsMap = useMemo(() => {
  const map: Record<string, { status: string; rejectionReason?: string }> = {};
  for (const a of (approvals || [])) {
    map[`${a.employeeId}_${a.businessDate}`] = a;
  }
  return map;
}, [approvals]);
```

**5b — En la fila expandida de cada empleado, para cada día con extras:**

Por cada `dailyBreakdown` entry que tenga `overtimeCalculatedMinutes > 0`,
mostrar los controles de aprobación a la derecha de la columna de flags.

El estado visual por día debe ser:
- Sin registro en `approvalsMap` → badge gris "Pendiente" + botones Aprobar / Rechazar
- `APPROVED` → badge verde "Aprobada" + botón gris "Revertir"
- `REJECTED` → badge rojo "Rechazada" + razón en tooltip + botón gris "Revertir"

Componente sugerido para cada día con extras:

```tsx
{day.overtimeCalculatedMinutes > 0 && (
  <OvertimeApprovalCell
    employeeId={emp.employeeId}
    businessDate={day.date}
    overtimeMinutes={day.overtimeCalculatedMinutes}
    approval={approvalsMap[`${emp.employeeId}_${day.date}`]}
    onApprove={() => handleApproveDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes)}
    onReject={(reason) => handleRejectDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes, reason)}
    onRevert={() => handleRevertDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes)}
  />
)}
```

**5c — Handlers:**

```typescript
async function handleApproveDay(employeeId: number, businessDate: string, overtimeMinutes: number) {
  await apiRequest("POST", "/api/hr/overtime-approvals", {
    employeeId, businessDate, status: "APPROVED", overtimeMinutes,
  });
  refetchApprovals();
  queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll"] });
}

async function handleRejectDay(
  employeeId: number, businessDate: string,
  overtimeMinutes: number, rejectionReason: string
) {
  await apiRequest("POST", "/api/hr/overtime-approvals", {
    employeeId, businessDate, status: "REJECTED", overtimeMinutes, rejectionReason,
  });
  refetchApprovals();
  queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll"] });
}

async function handleRevertDay(employeeId: number, businessDate: string, overtimeMinutes: number) {
  // Revertir = volver a PENDING (mismo endpoint, status PENDING)
  await apiRequest("POST", "/api/hr/overtime-approvals", {
    employeeId, businessDate, status: "PENDING", overtimeMinutes,
  });
  refetchApprovals();
  queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll"] });
}
```

**5d — Botones de aprobación/rechazo masivo por empleado:**

En el header de la fila expandida del empleado (donde aparece el nombre),
agregar dos botones que solo se muestran si hay días con extras pendientes:

```tsx
{pendingOvertimeDays.length > 0 && (
  <div style={{ display: "flex", gap: 8 }}>
    <button onClick={() => handleBulkApprove(emp)}>
      Aprobar todas ({pendingOvertimeDays.length})
    </button>
    <button onClick={() => setShowBulkRejectDialog(emp.employeeId)}>
      Rechazar todas
    </button>
  </div>
)}
```

Donde `pendingOvertimeDays` son los días del empleado que tienen
`overtimeCalculatedMinutes > 0` y no tienen registro APPROVED o REJECTED
en `approvalsMap`.

**5e — Dialog de rechazo (individual y masivo):**

Cuando el manager hace clic en "Rechazar" (individual o masivo),
mostrar un Dialog simple con:
- Texto: "Razón del rechazo (obligatorio)"
- Input textarea
- Botón "Confirmar rechazo" — deshabilitado si el textarea está vacío
- Botón "Cancelar"

Usar el componente `Dialog` de shadcn/ui ya disponible en el proyecto.

---

## VERIFICACIÓN FINAL

1. Compilar sin errores TypeScript
2. Tabla `hr_overtime_approvals` existe en la DB
3. Correr planilla → empleados con extras muestran Extra (Pag) = 0
4. Aprobar un día individual → Extra (Pag) se actualiza, Pago Base sube
5. Rechazar un día con razón → Extra (Pag) = 0, badge rojo con razón
6. Aprobar todas las extras de un empleado → todos los días en verde
7. Rechazar todas → dialog pide razón, aplica a todos los días pendientes
8. Revertir una aprobación → vuelve a Pendiente, Extra (Pag) = 0
