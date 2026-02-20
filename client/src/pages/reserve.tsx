import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Users, Clock, Phone, Mail, ChevronRight, ChevronLeft, Check, Loader2 } from "lucide-react";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type TimeSlot = { time: string; available: boolean; tablesAvailable: number };
type ResSettings = { openTime: string; closeTime: string; slotIntervalMinutes: number; enabled: boolean };

const STEPS = ["Personas", "Fecha y Hora", "Datos", "Confirmar"];

export default function PublicReservePage() {
  const [step, setStep] = useState(0);
  const [reservedDate, setReservedDate] = useState(todayStr());
  const [reservedTime, setReservedTime] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmation, setConfirmation] = useState<{ code: string; message: string } | null>(null);

  const { data: settings } = useQuery<ResSettings>({
    queryKey: ["/api/public/reservations/settings"],
    queryFn: async () => {
      const res = await fetch("/api/public/reservations/settings");
      if (!res.ok) return { openTime: "11:00", closeTime: "22:00", slotIntervalMinutes: 30, enabled: true };
      return res.json();
    },
  });

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
      setConfirmation({ code: data.reservationCode, message: "Reserva creada exitosamente" });
    },
  });

  const canAdvance = () => {
    if (step === 0) return partySize >= 1;
    if (step === 1) return !!reservedDate && !!reservedTime;
    if (step === 2) return guestName.trim().length >= 2 && guestPhone.trim().length >= 7;
    return true;
  };

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
    else submitMutation.mutate();
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
                {new Date(reservedDate + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", month: "long", day: "numeric" })}
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
            <button className="rp-btn primary" onClick={() => { setConfirmation(null); setStep(0); setReservedTime(""); setGuestName(""); setGuestPhone(""); setGuestEmail(""); setNotes(""); }}>
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

        <div className="rp-steps">
          {STEPS.map((s, i) => (
            <div key={i} className={`rp-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
              <div className="rp-step-num">{i < step ? <Check size={12} /> : i + 1}</div>
              <span className="rp-step-label">{s}</span>
            </div>
          ))}
        </div>

        {submitMutation.isError && (
          <div className="rp-error">{(submitMutation.error as Error).message}</div>
        )}

        <div className="rp-panel">
          {step === 0 && (
            <div className="rp-step-content">
              <label className="rp-label">¿Cuántas personas?</label>
              <div className="rp-party-selector">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                  <button key={n} className={`rp-party-btn ${partySize === n ? "selected" : ""}`} onClick={() => setPartySize(n)} data-testid={`button-party-${n}`}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <label className="rp-label" style={{ margin: 0 }}>Otro:</label>
                <input type="number" className="rp-input" style={{ width: 80 }} min={1} max={30} value={partySize} onChange={e => setPartySize(parseInt(e.target.value) || 1)} data-testid="input-party-custom" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="rp-step-content">
              <label className="rp-label">Seleccione fecha</label>
              <input type="date" className="rp-input" min={todayStr()} value={reservedDate} onChange={e => { setReservedDate(e.target.value); setReservedTime(""); }} data-testid="input-public-date" />
              {reservedDate && (
                <>
                  <label className="rp-label" style={{ marginTop: 14 }}>Horarios disponibles</label>
                  {timesLoading ? (
                    <div style={{ textAlign: "center", padding: 20 }}><Loader2 size={20} className="rp-spin" style={{ color: "var(--acc)" }} /></div>
                  ) : timeSlots.length === 0 ? (
                    <p className="rp-empty">No hay horarios disponibles para esta fecha</p>
                  ) : availableSlots.length === 0 ? (
                    <p className="rp-empty">Todos los horarios están ocupados para esta fecha</p>
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
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="rp-step-content">
              <label className="rp-label">Nombre completo</label>
              <input className="rp-input" placeholder="Su nombre" value={guestName} onChange={e => setGuestName(e.target.value)} data-testid="input-public-name" />
              <label className="rp-label" style={{ marginTop: 12 }}>Teléfono</label>
              <input className="rp-input" placeholder="8888-8888" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} data-testid="input-public-phone" />
              <label className="rp-label" style={{ marginTop: 12 }}>Email (opcional)</label>
              <input className="rp-input" placeholder="correo@ejemplo.com" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} data-testid="input-public-email" />
              <label className="rp-label" style={{ marginTop: 12 }}>Notas (opcional)</label>
              <textarea className="rp-input" rows={2} placeholder="Alergias, cumpleaños, preferencias..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: "none" }} data-testid="input-public-notes" />
            </div>
          )}

          {step === 3 && (
            <div className="rp-step-content">
              <label className="rp-label">Resumen de su reserva</label>
              <div className="rp-summary-card">
                <div className="rp-summary-row"><CalendarDays size={14} /> {new Date(reservedDate + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", month: "long", day: "numeric" })}</div>
                <div className="rp-summary-row"><Clock size={14} /> {reservedTime}</div>
                <div className="rp-summary-row"><Users size={14} /> {partySize} {partySize === 1 ? "persona" : "personas"}</div>
                <div className="rp-summary-row"><Phone size={14} /> {guestPhone}</div>
                {guestEmail && <div className="rp-summary-row"><Mail size={14} /> {guestEmail}</div>}
              </div>
              <p className="rp-confirm-note">Al confirmar, su reserva quedará en estado pendiente hasta que el restaurante la confirme.</p>
            </div>
          )}
        </div>

        <div className="rp-nav">
          {step > 0 && (
            <button className="rp-btn secondary" onClick={() => setStep(step - 1)} data-testid="button-prev-step">
              <ChevronLeft size={16} /> Anterior
            </button>
          )}
          <button className="rp-btn primary" disabled={!canAdvance() || submitMutation.isPending} onClick={handleNext} data-testid="button-next-step" style={{ marginLeft: "auto" }}>
            {submitMutation.isPending ? <Loader2 size={16} className="rp-spin" /> : step === 3 ? (
              <><Check size={16} /> Confirmar Reserva</>
            ) : (
              <>Siguiente <ChevronRight size={16} /></>
            )}
          </button>
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
        max-width: 440px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .rp-header {
        text-align: center;
        padding: 20px 0 10px;
      }
      .rp-logo-icon { color: var(--acc, #1d4ed8); margin: 0 auto 8px; display: block; }
      .rp-title {
        font-family: var(--f-disp, 'Outfit', sans-serif);
        font-weight: 700;
        font-size: 26px;
        margin: 0;
        color: var(--text, #1a1208);
      }
      .rp-steps {
        display: flex;
        justify-content: center;
        gap: 6px;
      }
      .rp-step {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .rp-step-num {
        width: 24px; height: 24px;
        border-radius: 50%;
        background: var(--s1, #f0ebe3);
        border: 1.5px solid var(--border, #ddd5c8);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 11px;
        font-weight: 600;
        color: var(--text3, #9c8e7e);
        transition: all 0.2s;
      }
      .rp-step.active .rp-step-num {
        background: var(--acc, #1d4ed8);
        border-color: var(--acc, #1d4ed8);
        color: #fff;
      }
      .rp-step.done .rp-step-num {
        background: var(--sage-d, rgba(74,124,89,0.09));
        border-color: var(--sage, #4a7c59);
        color: var(--sage, #4a7c59);
      }
      .rp-step-label {
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 9px;
        color: var(--text3, #9c8e7e);
        display: none;
      }
      .rp-step.active .rp-step-label {
        display: inline;
        color: var(--text, #1a1208);
      }
      .rp-panel {
        background: var(--s0, #ffffff);
        border: 1px solid var(--border, #ddd5c8);
        border-radius: var(--r-md, 14px);
        padding: 20px;
        min-height: 200px;
      }
      .rp-step-content { display: flex; flex-direction: column; }
      .rp-label {
        font-family: var(--f-mono, 'IBM Plex Mono', monospace);
        font-size: 10px;
        font-weight: 600;
        color: var(--text3, #9c8e7e);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }
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
      .rp-time-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      .rp-time-btn {
        background: var(--s0, #ffffff);
        border: 1.5px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 10px 0;
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
        opacity: 0.35;
        cursor: not-allowed;
        text-decoration: line-through;
      }
      .rp-party-selector {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .rp-party-btn {
        background: var(--s0, #ffffff);
        border: 1.5px solid var(--border, #ddd5c8);
        border-radius: var(--r-sm, 10px);
        padding: 14px 0;
        font-family: var(--f-disp, 'Outfit', sans-serif);
        font-size: 20px;
        font-weight: 700;
        color: var(--text, #1a1208);
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }
      .rp-party-btn:active { background: var(--s1, #f0ebe3); }
      .rp-party-btn.selected {
        background: var(--acc-d, rgba(29,78,216,0.07));
        border-color: var(--acc, #1d4ed8);
        color: var(--acc, #1d4ed8);
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
      .rp-confirm-note {
        font-size: 12px;
        color: var(--text3, #9c8e7e);
        margin-top: 14px;
        text-align: center;
        line-height: 1.5;
      }
      .rp-nav {
        display: flex;
        gap: 8px;
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
      .rp-btn.secondary {
        background: var(--s1, #f0ebe3);
        border: 1px solid var(--border, #ddd5c8);
        color: var(--text2, #5a4e40);
      }
      .rp-btn.secondary:active { background: var(--s2, #e6dfd5); }
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
        padding: 20px;
      }
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
