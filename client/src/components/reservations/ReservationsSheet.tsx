import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CalendarDays, Plus, Phone, Users, Clock, ChevronLeft, ChevronRight, Check, X, Armchair, Ban, UserCheck } from "lucide-react";
import { ReservationFormDialog } from "./ReservationFormDialog";

interface ReservationRow {
  id: number;
  reservationCode: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  reservedDate: string;
  reservedTime: string;
  durationMinutes: number;
  tableId: number | null;
  tableIds: number[] | null;
  status: string;
  notes: string | null;
  table: { id: number; tableName: string; tableCode: string } | null;
  tables?: { id: number; tableName: string; tableCode: string; capacity: number }[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  SEATED: "Sentados",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No llegó",
};

const STATUS_CLASSES: Record<string, string> = {
  PENDING: "badge-amber",
  CONFIRMED: "badge-blue",
  SEATED: "badge-green",
  COMPLETED: "badge-muted",
  CANCELLED: "badge-muted",
  NO_SHOW: "badge-muted",
};

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReservationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [formOpen, setFormOpen] = useState(false);
  const [editReservation, setEditReservation] = useState<ReservationRow | null>(null);

  const { data: reservationsList = [], isLoading } = useQuery<ReservationRow[]>({
    queryKey: ["/api/reservations", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/reservations?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error loading reservations");
      return res.json();
    },
    enabled: open,
    refetchInterval: 15000,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, reason }: { id: number; status: string; reason?: string }) => {
      const res = await apiRequest("PATCH", `/api/reservations/${id}/status`, { status, reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const pending = reservationsList.filter(r => r.status === "PENDING");
  const confirmed = reservationsList.filter(r => r.status === "CONFIRMED");
  const seated = reservationsList.filter(r => r.status === "SEATED");
  const past = reservationsList.filter(r => ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.status));

  const isToday = selectedDate === todayStr();
  const dayLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString("es-CR", { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 [&>button[class*='absolute']]:hidden" style={{ background: "var(--s0)", color: "var(--text)", fontFamily: "var(--f-body)" }}>
          <style>{`
            .res-sheet [data-radix-scroll-area-viewport] { background: var(--s0) !important; }
            .res-header {
              display: flex; align-items: center; justify-content: space-between;
              padding: 16px 18px 12px; border-bottom: 1px solid var(--border-ds);
            }
            .res-date-nav {
              display: flex; align-items: center; gap: 6px;
            }
            .res-date-btn {
              background: none; border: 1px solid var(--border-ds); color: var(--text2);
              border-radius: var(--r-sm); width: 32px; height: 32px;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; transition: background var(--t-fast);
            }
            .res-date-btn:active { background: var(--s2); }
            .res-date-label {
              font-family: var(--f-disp); font-weight: 700; font-size: 14px;
              text-transform: capitalize; min-width: 100px; text-align: center;
            }
            .res-today-btn {
              background: none; border: 1px solid var(--green); color: var(--green);
              border-radius: var(--r-sm); padding: 4px 10px; font-size: 11px;
              font-family: var(--f-mono); cursor: pointer; font-weight: 600;
            }
            .res-add-btn {
              background: var(--green); color: #050f08; border: none;
              border-radius: var(--r-sm); width: 44px; height: 44px;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; font-weight: 700;
            }
            .res-close-btn {
              background: none; border: 1px solid var(--border-ds); color: var(--text2);
              border-radius: var(--r-sm); width: 44px; height: 44px;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; transition: background var(--t-fast);
            }
            .res-close-btn:active { background: var(--s2); }
            .res-section-label {
              font-family: var(--f-mono); font-size: 10px; font-weight: 600;
              color: var(--text3); text-transform: uppercase; letter-spacing: 0.6px;
              padding: 12px 18px 6px;
            }
            .res-card {
              background: var(--s1); border: 1px solid var(--border-ds);
              border-radius: var(--r-md); margin: 4px 12px; padding: 12px 14px;
              cursor: pointer; transition: background var(--t-fast);
            }
            .res-card:active { background: var(--s2); }
            .res-card.pending { border-left: 3px solid #f39c12; }
            .res-card.confirmed { border-left: 3px solid #3498db; }
            .res-card.seated { border-left: 3px solid #2ecc71; }
            .res-card-top {
              display: flex; align-items: center; justify-content: space-between;
              margin-bottom: 6px;
            }
            .res-guest-name {
              font-family: var(--f-disp); font-weight: 700; font-size: 15px;
            }
            .res-code {
              font-family: var(--f-mono); font-size: 10px; color: var(--text3);
            }
            .res-card-meta {
              display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
              font-family: var(--f-mono); font-size: 11px; color: var(--text3);
            }
            .res-card-meta span { display: flex; align-items: center; gap: 3px; }
            .res-card-actions {
              display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
            }
            .res-action-btn {
              font-family: var(--f-mono); font-size: 10px; font-weight: 600;
              padding: 5px 10px; border-radius: var(--r-sm); cursor: pointer;
              border: 1px solid var(--border-ds); background: var(--s2);
              color: var(--text2); display: flex; align-items: center; gap: 4px;
              transition: all var(--t-fast);
            }
            .res-action-btn:active { background: var(--s1); }
            .res-action-btn.confirm { border-color: #3498db; color: #3498db; }
            .res-action-btn.seat { border-color: #2ecc71; color: #2ecc71; }
            .res-action-btn.cancel { border-color: #e74c3c; color: #e74c3c; }
            .res-action-btn.complete { border-color: var(--text3); color: var(--text3); }
            .res-empty {
              text-align: center; padding: 30px 20px; color: var(--text3);
              font-family: var(--f-mono); font-size: 12px;
            }
            .res-scroll {
              flex: 1; overflow-y: auto; padding-bottom: 20px;
            }
            .res-card-notes {
              font-family: var(--f-mono); font-size: 10px; color: var(--text3);
              margin-top: 4px; font-style: italic;
            }
          `}</style>

          <div className="res-sheet" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="res-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CalendarDays size={18} style={{ color: "var(--green)" }} />
                <span style={{ fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 16 }}>Reservas</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="res-add-btn" onClick={() => { setEditReservation(null); setFormOpen(true); }} data-testid="button-add-reservation">
                  <Plus size={16} />
                </button>
                <button
                  className="res-close-btn"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-close-reservations"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 18px", gap: 8, borderBottom: "1px solid var(--border-ds)" }}>
              <button className="res-date-btn" onClick={() => setSelectedDate(d => addDays(d, -1))} data-testid="button-prev-date">
                <ChevronLeft size={16} />
              </button>
              <span className="res-date-label">{dayLabel}</span>
              <button className="res-date-btn" onClick={() => setSelectedDate(d => addDays(d, 1))} data-testid="button-next-date">
                <ChevronRight size={16} />
              </button>
              {!isToday && (
                <button className="res-today-btn" onClick={() => setSelectedDate(todayStr())} data-testid="button-today">
                  Hoy
                </button>
              )}
            </div>

            <div className="res-scroll">
              {isLoading ? (
                <div className="res-empty">Cargando...</div>
              ) : reservationsList.length === 0 ? (
                <div className="res-empty">
                  <CalendarDays size={28} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                  Sin reservas para este día
                </div>
              ) : (
                <>
                  {pending.length > 0 && (
                    <>
                      <div className="res-section-label">Pendientes ({pending.length})</div>
                      {pending.map(r => (
                        <ReservationCard
                          key={r.id}
                          reservation={r}
                          onStatusChange={(status, reason) => statusMutation.mutate({ id: r.id, status, reason })}
                          onEdit={() => { setEditReservation(r); setFormOpen(true); }}
                        />
                      ))}
                    </>
                  )}
                  {confirmed.length > 0 && (
                    <>
                      <div className="res-section-label">Confirmadas ({confirmed.length})</div>
                      {confirmed.map(r => (
                        <ReservationCard
                          key={r.id}
                          reservation={r}
                          onStatusChange={(status, reason) => statusMutation.mutate({ id: r.id, status, reason })}
                          onEdit={() => { setEditReservation(r); setFormOpen(true); }}
                        />
                      ))}
                    </>
                  )}
                  {seated.length > 0 && (
                    <>
                      <div className="res-section-label">Sentados ({seated.length})</div>
                      {seated.map(r => (
                        <ReservationCard
                          key={r.id}
                          reservation={r}
                          onStatusChange={(status, reason) => statusMutation.mutate({ id: r.id, status, reason })}
                          onEdit={() => { setEditReservation(r); setFormOpen(true); }}
                        />
                      ))}
                    </>
                  )}
                  {past.length > 0 && (
                    <>
                      <div className="res-section-label">Historial ({past.length})</div>
                      {past.map(r => (
                        <ReservationCard
                          key={r.id}
                          reservation={r}
                          onStatusChange={(status, reason) => statusMutation.mutate({ id: r.id, status, reason })}
                          onEdit={() => { setEditReservation(r); setFormOpen(true); }}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ReservationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        reservation={editReservation}
        selectedDate={selectedDate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/reservations", selectedDate] });
          queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
        }}
      />
    </>
  );
}

function ReservationCard({
  reservation: r,
  onStatusChange,
  onEdit,
}: {
  reservation: ReservationRow;
  onStatusChange: (status: string, reason?: string) => void;
  onEdit: () => void;
}) {
  const statusCls = r.status === "PENDING" ? "pending" : r.status === "CONFIRMED" ? "confirmed" : r.status === "SEATED" ? "seated" : "";
  const isPast = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.status);

  return (
    <div className={`res-card ${statusCls}`} onClick={() => { if (!isPast) onEdit(); }} data-testid={`card-reservation-${r.id}`}>
      <div className="res-card-top">
        <span className="res-guest-name">{r.guestName}</span>
        <span className={`badge-ds ${STATUS_CLASSES[r.status] || "badge-muted"}`} style={{ fontSize: 10 }}>
          {STATUS_LABELS[r.status] || r.status}
        </span>
      </div>
      <div className="res-card-meta">
        <span><Clock size={11} /> {r.reservedTime.slice(0, 5)}</span>
        <span><Users size={11} /> {r.partySize}p</span>
        <span><Phone size={11} /> {r.guestPhone}</span>
        {(r.tables && r.tables.length > 0) ? (
          <span><Armchair size={11} /> {r.tables.map(t => t.tableName).join(" + ")}</span>
        ) : r.table ? (
          <span><Armchair size={11} /> {r.table.tableName}</span>
        ) : null}
      </div>
      {r.notes && <div className="res-card-notes">{r.notes}</div>}
      {!isPast && (
        <div className="res-card-actions" onClick={e => e.stopPropagation()}>
          {r.status === "PENDING" && (
            <>
              <button className="res-action-btn confirm" onClick={() => onStatusChange("CONFIRMED")} data-testid={`button-confirm-${r.id}`}>
                <Check size={11} /> Confirmar
              </button>
              <button className="res-action-btn cancel" onClick={() => { const reason = prompt("Razón de cancelación (opcional):"); onStatusChange("CANCELLED", reason || undefined); }} data-testid={`button-cancel-${r.id}`}>
                <X size={11} /> Cancelar
              </button>
            </>
          )}
          {r.status === "CONFIRMED" && (
            <>
              <button className="res-action-btn seat" onClick={() => onStatusChange("SEATED")} data-testid={`button-seat-${r.id}`}>
                <UserCheck size={11} /> Sentar
              </button>
              <button className="res-action-btn cancel" onClick={() => onStatusChange("NO_SHOW")} data-testid={`button-noshow-${r.id}`}>
                <Ban size={11} /> No llegó
              </button>
              <button className="res-action-btn cancel" onClick={() => { const reason = prompt("Razón de cancelación (opcional):"); onStatusChange("CANCELLED", reason || undefined); }} data-testid={`button-cancel-${r.id}`}>
                <X size={11} /> Cancelar
              </button>
            </>
          )}
          {r.status === "SEATED" && (
            <button className="res-action-btn complete" onClick={() => onStatusChange("COMPLETED")} data-testid={`button-complete-${r.id}`}>
              <Check size={11} /> Completar
            </button>
          )}
        </div>
      )}
      <div className="res-code">{r.reservationCode}</div>
    </div>
  );
}
