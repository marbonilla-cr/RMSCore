import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CalendarDays, Users, Clock, Phone, Mail, Check, Loader2, ChevronDown, MessageSquare } from "lucide-react";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type TimeSlot = { time: string; available: boolean; seatsAvailable: number };
type ResSettings = { openTime: string; closeTime: string; slotIntervalMinutes: number; enabled: boolean; maxPartySize: number };

export default function PublicReservePage() {
  const [reservedDate, setReservedDate] = useState(todayStr());
  const [reservedTime, setReservedTime] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmation, setConfirmation] = useState<{ code: string } | null>(null);

  const { data: settings } = useQuery<ResSettings>({
    queryKey: ["/api/public/reservations/settings"],
    queryFn: async () => {
      const res = await fetch("/api/public/reservations/settings");
      if (!res.ok) return { openTime: "11:00", closeTime: "22:00", slotIntervalMinutes: 30, enabled: true, maxPartySize: 20 };
      return res.json();
    },
  });

  const maxParty = settings?.maxPartySize ?? 20;

  const { data: timeSlots = [], isLoading: timesLoading } = useQuery<TimeSlot[]>({
    queryKey: ["/api/public/reservations/available-times", reservedDate, partySize],
    queryFn: async () => {
      const res = await fetch(`/api/public/reservations/available-times?date=${reservedDate}&partySize=${partySize}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!reservedDate && partySize > 0 && settings?.enabled !== false,
  });

  const availableSlots = timeSlots.filter(s => s.available);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName,
          guestPhone,
          guestEmail: guestEmail || undefined,
          partySize,
          reservedDate,
          reservedTime,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Error al crear la reserva");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setConfirmation({ code: data.reservationCode });
      queryClient.invalidateQueries({ queryKey: ["/api/public/reservations/available-times"] });
    },
  });

  const canSubmit = partySize >= 1 && !!reservedDate && !!reservedTime && guestName.trim().length >= 2 && guestPhone.trim().length >= 7;

  const handleNewReservation = () => {
    setConfirmation(null);
    setReservedTime("");
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setNotes("");
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
    } catch {
      return dateStr;
    }
  };

  if (settings && !settings.enabled) {
    return (
      <div className="reserve-page">
        <ReserveStyles />
        <div className="rp-container">
          <div className="rp-header">
            <CalendarDays size={24} className="rp-logo-icon" />
            <h1 className="rp-title">Reservaciones</h1>
          </div>
          <div className="rp-panel" style={{ textAlign: "center", padding: 40 }}>
            <p className="rp-empty">El sistema de reservaciones no está disponible en este momento.</p>
          </div>
        </div>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="reserve-page">
        <ReserveStyles />
        <div className="rp-container">
          <div className="rp-success">
            <div className="rp-success-icon"><Check size={32} /></div>
            <h2 className="rp-success-title">Reserva Confirmada</h2>
            <p className="rp-success-sub">Su reserva ha sido registrada</p>
            <div className="rp-success-code">{confirmation.code}</div>
            <div className="rp-summary-card">
              <div className="rp-summary-row">
                <CalendarDays size={14} />
                {formatDate(reservedDate)}
              </div>
              <div className="rp-summary-row">
                <Clock size={14} />
                {reservedTime}
              </div>
              <div className="rp-summary-row">
                <Users size={14} />
                {partySize} {partySize === 1 ? "persona" : "personas"}
              </div>
            </div>
            <p className="rp-success-note">Recibirá una confirmación por email si proporcionó uno.</p>
            <button className="rp-btn primary" onClick={handleNewReservation} data-testid="button-new-reservation">
              Nueva Reserva
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reserve-page">
      <ReserveStyles />
      <div className="rp-container">
        <div className="rp-header">
          <CalendarDays size={24} className="rp-logo-icon" />
          <h1 className="rp-title">Reservar Mesa</h1>
        </div>

        {submitMutation.isError && (
          <div className="rp-error">{(submitMutation.error as Error).message}</div>
        )}

        <div className="rp-panel">
          <div className="rp-form">
            <div className="rp-row-2">
              <div className="rp-field">
                <label className="rp-label"><CalendarDays size={11} /> Fecha</label>
                <div className="rp-date-wrap">
                  <div className="rp-date-display">
                    <span className="rp-date-text">{formatDate(reservedDate)}</span>
                    <ChevronDown size={14} />
                  </div>
                  <input
                    type="date"
                    className="rp-date-native"
                    min={todayStr()}
                    value={reservedDate}
                    onChange={e => { if (e.target.value) { setReservedDate(e.target.value); setReservedTime(""); }}}
                    data-testid="input-public-date"
                  />
                </div>
              </div>
              <div className="rp-field">
                <label className="rp-label"><Users size={11} /> Personas</label>
                <select
                  className="rp-select"
                  value={partySize}
                  onChange={e => { setPartySize(parseInt(e.target.value)); setReservedTime(""); }}
                  data-testid="select-party-size"
                >
                  {Array.from({ length: maxParty }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? "persona" : "personas"}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rp-field">
              <label className="rp-label"><Clock size={11} /> Horario</label>
              {timesLoading ? (
                <div style={{ textAlign: "center", padding: 16 }}><Loader2 size={18} className="rp-spin" style={{ color: "var(--acc)" }} /></div>
              ) : timeSlots.length === 0 ? (
                <p className="rp-empty">No hay horarios disponibles para esta fecha</p>
              ) : availableSlots.length === 0 ? (
                <p className="rp-empty">Todos los horarios están ocupados</p>
              ) : (
                <div className="rp-time-grid">
                  {timeSlots.map(slot => (
                    <button
                      key={slot.time}
                      className={`rp-time-btn ${reservedTime === slot.time ? "selected" : ""} ${!slot.available ? "disabled" : ""}`}
                      onClick={() => slot.available && setReservedTime(slot.time)}
                      disabled={!slot.available}
                      data-testid={`button-time-${slot.time}`}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rp-divider" />

            <div className="rp-field">
              <label className="rp-label">Nombre completo</label>
              <input className="rp-input" placeholder="Su nombre" value={guestName} onChange={e => setGuestName(e.target.value)} data-testid="input-public-name" />
            </div>
            <div className="rp-row-2">
              <div className="rp-field">
                <label className="rp-label"><Phone size={11} /> Teléfono</label>
                <input className="rp-input" placeholder="8888-8888" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} data-testid="input-public-phone" />
              </div>
              <div className="rp-field">
                <label className="rp-label"><Mail size={11} /> Email <span style={{ opacity: 0.5 }}>(opcional)</span></label>
                <input className="rp-input" placeholder="correo@ejemplo.com" type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} data-testid="input-public-email" />
              </div>
            </div>
            <div className="rp-field">
              <label className="rp-label"><MessageSquare size={11} /> Notas <span style={{ opacity: 0.5 }}>(opcional)</span></label>
              <textarea className="rp-input" rows={2} placeholder="Alergias, cumpleaños, preferencias..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: "none" }} data-testid="input-public-notes" />
            </div>

            <button
              className="rp-btn primary rp-submit"
              disabled={!canSubmit || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              data-testid="button-confirm-reservation"
            >
              {submitMutation.isPending ? <Loader2 size={16} className="rp-spin" /> : <Check size={16} />}
              Confirmar Reserva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReserveStyles() {
  return (
    <style>{`
      .reserve-page {
        min-height: 100dvh;
        background: var(--bg, #f7f3ee);
        color: var(--text, #1a1208);
        font-family: var(--f-body, 'IBM Plex Sans', sans-serif);
        display: flex;
        justify-content: center;
        padding: 20px;
      }
      .rp-container {
        width: 100%;
        max-width: 480px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .rp-header {
        text-align: center;
        padding: 16px 0 4px;
      }
      .rp-logo-icon { color: var(--acc, #1d4ed8); margin: 0 auto 6px; display: block; }
      .rp-title {
        font-family: var(--f-disp, 'Outfit', sans-serif);
        font-weight: 700;
        font-size: 24px;
        margin: 0;
        color: var(--text, #1a1208);
      }
      .rp-panel {
        background: var(--s0, #ffffff);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-md, 14px);
        padding: 18px;
      }
      .rp-form { display: flex; flex-direction: column; gap: 14px; }
      .rp-field { display: flex; flex-direction: column; gap: 4px; }
      .rp-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .rp-label {
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 10px;
        font-weight: 600;
        color: var(--text3, #9c8e7e);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .rp-label svg { flex-shrink: 0; }
      .rp-input {
        background: var(--s1, #f0ebe3);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 10px 12px;
        font-family: var(--f-body, 'IBM Plex Sans', sans-serif);
        font-size: 14px;
        color: var(--text, #1a1208);
        outline: none;
        width: 100%;
        box-sizing: border-box;
        transition: border-color 0.15s;
      }
      .rp-input:focus { border-color: var(--acc, #1d4ed8); }
      .rp-input::placeholder { color: var(--text4, #c4b9ac); }
      .rp-select {
        background: var(--s1, #f0ebe3);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 10px 12px;
        font-family: var(--f-body, 'IBM Plex Sans', sans-serif);
        font-size: 14px;
        color: var(--text, #1a1208);
        outline: none;
        width: 100%;
        box-sizing: border-box;
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239c8e7e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 32px;
        cursor: pointer;
        transition: border-color 0.15s;
      }
      .rp-select:focus { border-color: var(--acc, #1d4ed8); }
      .rp-date-wrap {
        position: relative;
      }
      .rp-date-display {
        background: var(--s1, #f0ebe3);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        pointer-events: none;
      }
      .rp-date-text {
        font-family: var(--f-body, 'IBM Plex Sans', sans-serif);
        font-size: 14px;
        color: var(--text, #1a1208);
        text-transform: capitalize;
      }
      .rp-date-native {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
        font-size: 16px;
        -webkit-appearance: none;
        border: none;
        background: transparent;
      }
      .rp-divider {
        height: 1px;
        background: var(--border, #ddd5c8);
        margin: 2px 0;
      }
      .rp-time-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      @media (max-width: 360px) {
        .rp-time-grid { grid-template-columns: repeat(3, 1fr); }
      }
      .rp-time-btn {
        background: var(--s0, #ffffff);
        border: 1.5px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 9px 0;
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 13px;
        font-weight: 600;
        color: var(--text, #1a1208);
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }
      .rp-time-btn:active:not(:disabled) { background: var(--s1, #f0ebe3); }
      .rp-time-btn.selected {
        background: var(--acc-d, rgba(29,78,216,0.07));
        border-color: var(--acc, #1d4ed8);
        color: var(--acc, #1d4ed8);
      }
      .rp-time-btn.disabled {
        opacity: 0.3;
        cursor: not-allowed;
        text-decoration: line-through;
      }
      .rp-submit {
        width: 100%;
        justify-content: center;
        padding: 14px;
        font-size: 15px;
        margin-top: 4px;
      }
      .rp-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 12px 20px;
        border-radius: var(--r-sm, 10px);
        font-family: var(--f-disp, 'Outfit', sans-serif);
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }
      .rp-btn.primary {
        background: var(--acc, #1d4ed8);
        color: #fff;
      }
      .rp-btn.primary:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rp-btn.primary:active:not(:disabled) { opacity: 0.8; }
      .rp-error {
        background: var(--red-d, rgba(220,38,38,0.08));
        border: 1px solid var(--red-m, rgba(220,38,38,0.18));
        border-radius: var(--r-sm, 10px);
        padding: 10px 14px;
        font-size: 13px;
        color: var(--red, #dc2626);
      }
      .rp-empty {
        font-size: 13px;
        color: var(--text3, #9c8e7e);
        text-align: center;
        padding: 16px;
      }
      .rp-summary-card {
        background: var(--s1, #f0ebe3);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .rp-summary-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: var(--text2, #5a4e40);
      }
      .rp-summary-row svg { color: var(--acc, #1d4ed8); flex-shrink: 0; }
      .rp-success {
        text-align: center;
        padding: 30px 0;
      }
      .rp-success-icon {
        width: 56px; height: 56px;
        border-radius: 50%;
        background: var(--sage-d, rgba(74,124,89,0.09));
        color: var(--sage, #4a7c59);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
      }
      .rp-success-title {
        font-family: var(--f-disp, 'Outfit', sans-serif);
        font-weight: 700;
        font-size: 22px;
        margin: 0 0 4px;
        color: var(--text, #1a1208);
      }
      .rp-success-sub {
        font-size: 14px;
        color: var(--text3, #9c8e7e);
        margin: 0 0 16px;
      }
      .rp-success-code {
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 18px;
        font-weight: 600;
        color: var(--acc, #1d4ed8);
        padding: 10px 20px;
        background: var(--acc-d, rgba(29,78,216,0.07));
        border: 1px solid var(--acc-m, rgba(29,78,216,0.18));
        border-radius: var(--r-sm, 10px);
        display: inline-block;
        margin-bottom: 20px;
      }
      .rp-success-note {
        font-size: 12px;
        color: var(--text3, #9c8e7e);
        margin-top: 16px;
      }
      @keyframes rp-spin {
        to { transform: rotate(360deg); }
      }
      .rp-spin { animation: rp-spin 0.8s linear infinite; }
    `}</style>
  );
}
