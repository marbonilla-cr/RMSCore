import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";

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
}

interface TableOption {
  id: number;
  tableName: string;
  tableCode: string;
  capacity: number;
  reservations: { id: number; guestName: string; reservedTime: string; durationMinutes: number; endTime: string }[];
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const TIME_SLOTS: string[] = [];
for (let h = 11; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 22 && m > 0) break;
    TIME_SLOTS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

export function ReservationFormDialog({
  open,
  onOpenChange,
  reservation,
  selectedDate,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reservation: ReservationRow | null;
  selectedDate: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!reservation;

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [reservedDate, setReservedDate] = useState(selectedDate);
  const [reservedTime, setReservedTime] = useState("19:00");
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      if (reservation) {
        setGuestName(reservation.guestName);
        setGuestPhone(reservation.guestPhone);
        setGuestEmail(reservation.guestEmail || "");
        setPartySize(reservation.partySize);
        setReservedDate(reservation.reservedDate);
        setReservedTime(reservation.reservedTime.slice(0, 5));
        setSelectedTableIds(reservation.tableIds || (reservation.tableId ? [reservation.tableId] : []));
        setNotes(reservation.notes || "");
      } else {
        setGuestName("");
        setGuestPhone("");
        setGuestEmail("");
        setPartySize(2);
        setReservedDate(selectedDate);
        setReservedTime("19:00");
        setSelectedTableIds([]);
        setNotes("");
      }
    }
  }, [open, reservation, selectedDate]);

  const { data: availableTables = [] } = useQuery<TableOption[]>({
    queryKey: ["/api/reservations/availability", reservedDate, partySize],
    queryFn: async () => {
      const res = await fetch(`/api/reservations/availability?date=${reservedDate}&partySize=${partySize}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!reservedDate && partySize > 0,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        guestName,
        guestPhone,
        guestEmail: guestEmail || undefined,
        partySize,
        reservedDate,
        reservedTime,
        tableIds: selectedTableIds.length > 0 ? selectedTableIds : undefined,
        notes: notes || undefined,
      };
      if (isEdit) {
        const res = await apiRequest("PATCH", `/api/reservations/${reservation!.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/reservations", body);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Reserva actualizada" : "Reserva creada" });
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isValid = guestName.trim().length >= 2 && guestPhone.trim().length >= 7 && partySize >= 1 && !!reservedTime && (isEdit || reservedDate >= todayStr());

  const tableOptions = availableTables.map(t => {
    const conflictCount = t.reservations.filter(r => {
      if (isEdit && reservation && r.id === reservation.id) return false;
      return true;
    }).length;
    return { ...t, conflictCount };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden" style={{ background: "var(--s0)", color: "var(--text)", fontFamily: "var(--f-body)", border: "1px solid var(--border-ds)", maxHeight: "90dvh" }}>
        <style>{`
          .rf-scroll { overflow-y: auto; max-height: calc(90dvh - 52px); }
          .rf-form { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
          .rf-field { display: flex; flex-direction: column; gap: 4px; }
          .rf-label {
            font-family: var(--f-mono); font-size: 10px; font-weight: 600;
            color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px;
          }
          .rf-input {
            background: var(--s1); border: 1px solid var(--border-ds);
            border-radius: var(--r-sm); padding: 10px 12px;
            font-family: var(--f-body); font-size: 14px; color: var(--text);
            outline: none; transition: border-color var(--t-fast);
          }
          .rf-input:focus { border-color: var(--green); }
          .rf-input::placeholder { color: var(--text3); }
          .rf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .rf-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
          .rf-submit {
            background: var(--green); color: #050f08; border: none;
            border-radius: var(--r-sm); padding: 12px;
            font-family: var(--f-disp); font-weight: 700; font-size: 14px;
            cursor: pointer; transition: opacity var(--t-fast);
          }
          .rf-submit:disabled { opacity: 0.4; cursor: not-allowed; }
          .rf-submit:active:not(:disabled) { opacity: 0.8; }
        `}</style>

        <div style={{ padding: "16px 18px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 17 }}>
            {isEdit ? "Editar Reserva" : "Nueva Reserva"}
          </span>
          <button onClick={() => onOpenChange(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div className="rf-scroll">
          <div className="rf-form">
            <div className="rf-field">
              <label className="rf-label">Nombre del cliente</label>
              <input className="rf-input" placeholder="Nombre completo" value={guestName} onChange={e => setGuestName(e.target.value)} data-testid="input-guest-name" />
            </div>

            <div className="rf-row">
              <div className="rf-field">
                <label className="rf-label">Teléfono</label>
                <input className="rf-input" placeholder="8888-8888" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} data-testid="input-guest-phone" />
              </div>
              <div className="rf-field">
                <label className="rf-label">Email (opc.)</label>
                <input className="rf-input" placeholder="email@..." value={guestEmail} onChange={e => setGuestEmail(e.target.value)} data-testid="input-guest-email" />
              </div>
            </div>

            <div className="rf-row3">
              <div className="rf-field">
                <label className="rf-label">Personas</label>
                <input className="rf-input" type="number" min={1} max={30} value={partySize} onChange={e => setPartySize(parseInt(e.target.value) || 1)} data-testid="input-party-size" />
              </div>
              <div className="rf-field">
                <label className="rf-label">Fecha</label>
                <input className="rf-input" type="date" min={todayStr()} value={reservedDate} onChange={e => setReservedDate(e.target.value)} data-testid="input-reserved-date" />
              </div>
              <div className="rf-field">
                <label className="rf-label">Hora</label>
                <select className="rf-input" value={reservedTime} onChange={e => setReservedTime(e.target.value)} data-testid="select-reserved-time" style={{ padding: "10px 8px" }}>
                  {TIME_SLOTS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rf-field">
              <label className="rf-label">
                Mesas ({selectedTableIds.length === 0 ? "Auto" : selectedTableIds.length + " sel."})
                {selectedTableIds.length > 0 && (
                  <span style={{ marginLeft: 8, color: "var(--green)", cursor: "pointer", fontWeight: 400 }} onClick={() => setSelectedTableIds([])}>Limpiar</span>
                )}
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tableOptions.map(t => {
                  const isSelected = selectedTableIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`table-chip-${t.id}`}
                      onClick={() => {
                        setSelectedTableIds(prev =>
                          prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                        );
                      }}
                      style={{
                        padding: "6px 10px", borderRadius: "var(--r-sm)", fontSize: 11,
                        fontFamily: "var(--f-mono)", fontWeight: 600, cursor: "pointer",
                        border: isSelected ? "1px solid var(--green)" : "1px solid var(--border-ds)",
                        background: isSelected ? "rgba(46,204,113,0.15)" : "var(--s2)",
                        color: isSelected ? "var(--green)" : "var(--text2)",
                        transition: "all 0.15s",
                      }}
                    >
                      {t.tableName} ({t.capacity}p)
                      {t.conflictCount > 0 && <span style={{ color: "#f39c12", marginLeft: 4 }}>({t.conflictCount}R)</span>}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text3)" }}>
                {selectedTableIds.length === 0 ? "Sin selección = asignación automática" : `${tableOptions.filter(t => selectedTableIds.includes(t.id)).reduce((s, t) => s + t.capacity, 0)} sillas seleccionadas`}
              </span>
            </div>

            <div className="rf-field">
              <label className="rf-label">Notas (opc.)</label>
              <textarea className="rf-input" rows={2} placeholder="Cumpleaños, alergias..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: "none" }} data-testid="input-notes" />
            </div>

            <button className="rf-submit" disabled={!isValid || saveMutation.isPending} onClick={() => saveMutation.mutate()} data-testid="button-save-reservation">
              {saveMutation.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear reserva"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
