import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Users, Clock, Phone, Mail, ChevronRight, ChevronLeft, Check, Loader2 } from "lucide-react";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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

  const { data: availableTimes = [] } = useQuery<string[]>({
    queryKey: ["/api/public/reservations/available-times", reservedDate, partySize],
    queryFn: async () => {
      const res = await fetch(`/api/public/reservations/available-times?date=${reservedDate}&partySize=${partySize}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!reservedDate && partySize > 0,
  });

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
                  {availableTimes.length === 0 ? (
                    <p className="rp-empty">No hay horarios disponibles para esta fecha</p>
                  ) : (
                    <div className="rp-time-grid">
                      {availableTimes.map(t => (
                        <button key={t} className={`rp-time-btn ${reservedTime === t ? "selected" : ""}`} onClick={() => setReservedTime(t)} data-testid={`button-time-${t}`}>
                          {t}
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
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=Barlow:wght@400;500&family=JetBrains+Mono:wght@400;600&display=swap');

      .reserve-page {
        min-height: 100dvh;
        background: #0a0c0f;
        color: #e2e2e2;
        font-family: 'Barlow', sans-serif;
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
      .rp-logo-icon { color: #2ecc71; margin: 0 auto 8px; display: block; }
      .rp-title {
        font-family: 'Barlow Condensed', sans-serif;
        font-weight: 800;
        font-size: 26px;
        margin: 0;
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
        background: #181c22;
        border: 1.5px solid #2a2f38;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        color: #6b7280;
        transition: all 0.2s;
      }
      .rp-step.active .rp-step-num {
        background: #2ecc71;
        border-color: #2ecc71;
        color: #050f08;
      }
      .rp-step.done .rp-step-num {
        background: rgba(46,204,113,0.15);
        border-color: #2ecc71;
        color: #2ecc71;
      }
      .rp-step-label {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9px;
        color: #6b7280;
        display: none;
      }
      .rp-step.active .rp-step-label {
        display: inline;
        color: #e2e2e2;
      }
      .rp-panel {
        background: #111318;
        border: 1px solid #1e2128;
        border-radius: 12px;
        padding: 20px;
        min-height: 200px;
      }
      .rp-step-content { display: flex; flex-direction: column; }
      .rp-label {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }
      .rp-input {
        background: #181c22;
        border: 1px solid #2a2f38;
        border-radius: 8px;
        padding: 10px 12px;
        font-family: 'Barlow', sans-serif;
        font-size: 14px;
        color: #e2e2e2;
        outline: none;
        width: 100%;
        box-sizing: border-box;
        transition: border-color 0.15s;
      }
      .rp-input:focus { border-color: #2ecc71; }
      .rp-input::placeholder { color: #4b5563; }
      .rp-time-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      .rp-time-btn {
        background: #181c22;
        border: 1.5px solid #2a2f38;
        border-radius: 8px;
        padding: 10px 0;
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        font-weight: 600;
        color: #e2e2e2;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }
      .rp-time-btn:active { background: #1e2128; }
      .rp-time-btn.selected {
        background: rgba(46,204,113,0.12);
        border-color: #2ecc71;
        color: #2ecc71;
      }
      .rp-party-selector {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .rp-party-btn {
        background: #181c22;
        border: 1.5px solid #2a2f38;
        border-radius: 10px;
        padding: 14px 0;
        font-family: 'Barlow Condensed', sans-serif;
        font-size: 20px;
        font-weight: 800;
        color: #e2e2e2;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }
      .rp-party-btn:active { background: #1e2128; }
      .rp-party-btn.selected {
        background: rgba(46,204,113,0.12);
        border-color: #2ecc71;
        color: #2ecc71;
      }
      .rp-summary-card {
        background: #181c22;
        border: 1px solid #2a2f38;
        border-radius: 10px;
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
        color: #c8c8c8;
      }
      .rp-summary-row svg { color: #2ecc71; flex-shrink: 0; }
      .rp-confirm-note {
        font-size: 12px;
        color: #6b7280;
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
        border-radius: 10px;
        font-family: 'Barlow Condensed', sans-serif;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }
      .rp-btn.primary {
        background: #2ecc71;
        color: #050f08;
      }
      .rp-btn.primary:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rp-btn.primary:active:not(:disabled) { opacity: 0.8; }
      .rp-btn.secondary {
        background: #181c22;
        border: 1px solid #2a2f38;
        color: #c8c8c8;
      }
      .rp-btn.secondary:active { background: #1e2128; }
      .rp-error {
        background: rgba(231,76,60,0.1);
        border: 1px solid rgba(231,76,60,0.3);
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 13px;
        color: #e74c3c;
      }
      .rp-empty {
        font-size: 13px;
        color: #6b7280;
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
        background: rgba(46,204,113,0.15);
        color: #2ecc71;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
      }
      .rp-success-title {
        font-family: 'Barlow Condensed', sans-serif;
        font-weight: 800;
        font-size: 22px;
        margin: 0 0 4px;
      }
      .rp-success-sub {
        font-size: 14px;
        color: #6b7280;
        margin: 0 0 16px;
      }
      .rp-success-code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 18px;
        font-weight: 600;
        color: #2ecc71;
        padding: 10px 20px;
        background: rgba(46,204,113,0.1);
        border: 1px solid rgba(46,204,113,0.2);
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 20px;
      }
      .rp-success-note {
        font-size: 12px;
        color: #6b7280;
        margin-top: 16px;
      }
      @keyframes rp-spin {
        to { transform: rotate(360deg); }
      }
      .rp-spin { animation: rp-spin 0.8s linear infinite; }
    `}</style>
  );
}
