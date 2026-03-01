import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { VOID_REASONS, type VoidReasonCode } from "@shared/voidReasons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Minus, Plus } from "lucide-react";

export interface VoidItemDialogItem {
  orderId: number;
  itemId: number;
  productName: string;
  qty: number;
  sentToKitchenAt: string | null;
}

interface VoidItemDialogProps {
  item: VoidItemDialogItem;
  userCanAuthorize: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function VoidItemDialog({ item, userCanAuthorize, onClose, onSuccess }: VoidItemDialogProps) {
  const [reasonCode, setReasonCode] = useState<VoidReasonCode | "">("");
  const [reasonText, setReasonText] = useState("");
  const [qtyToVoid, setQtyToVoid] = useState(item.qty);
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState("");

  const needsReason = !!item.sentToKitchenAt;
  const needsPin = needsReason && !userCanAuthorize;

  const voidMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { qtyToVoid };
      if (reasonCode) {
        body.reasonCode = reasonCode;
      }
      if (reasonCode === "OTHER" && reasonText.trim()) {
        body.reasonText = reasonText.trim();
      }
      if (!reasonCode && !needsReason) {
        body.reason = reasonText.trim() || "Sin razón";
      }
      if (needsPin && managerPin) {
        body.managerPin = managerPin;
      }
      return apiRequest("POST", `/api/waiter/orders/${item.orderId}/items/${item.itemId}/void`, body);
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (err: any) => {
      const msg = err.message || "";
      if (msg.includes("gerente") || msg.includes("PIN") || msg.includes("autorización") || msg.includes("permiso") || msg.includes("intentos")) {
        setPinError(msg.replace(/^\d+:\s*/, ""));
        setManagerPin("");
      } else {
        setPinError(msg.replace(/^\d+:\s*/, ""));
      }
    },
  });

  const canSubmit = () => {
    if (needsReason && !reasonCode) return false;
    if (reasonCode === "OTHER" && reasonText.trim().length < 3) return false;
    if (needsPin && managerPin.length < 4) return false;
    if (qtyToVoid < 1 || qtyToVoid > item.qty) return false;
    return true;
  };

  const handlePinDigit = (digit: string) => {
    if (managerPin.length < 6) {
      setPinError("");
      setManagerPin(prev => prev + digit);
    }
  };

  const handlePinBackspace = () => {
    setPinError("");
    setManagerPin(prev => prev.slice(0, -1));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="dialog-void-item">
        <DialogHeader>
          <DialogTitle data-testid="text-void-dialog-title">Anular ítem</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground" data-testid="text-void-item-name">
            {item.productName} (x{item.qty})
          </div>

          {item.qty > 1 && (
            <div className="space-y-1">
              <Label>Cantidad a anular</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQtyToVoid(Math.max(1, qtyToVoid - 1))}
                  disabled={qtyToVoid <= 1}
                  data-testid="button-void-qty-minus"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center font-medium" data-testid="text-void-qty">{qtyToVoid}</span>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQtyToVoid(Math.min(item.qty, qtyToVoid + 1))}
                  disabled={qtyToVoid >= item.qty}
                  data-testid="button-void-qty-plus"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setQtyToVoid(item.qty)}
                  data-testid="button-void-qty-all"
                >
                  Todos
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>{needsReason ? "Razón (obligatoria)" : "Razón"}</Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as VoidReasonCode)}
            >
              <SelectTrigger data-testid="select-void-reason">
                <SelectValue placeholder="Seleccionar razón..." />
              </SelectTrigger>
              <SelectContent>
                {VOID_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code} data-testid={`select-option-${r.code}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reasonCode === "OTHER" && (
            <div className="space-y-1">
              <Label>Especifique la razón</Label>
              <Textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Mínimo 3 caracteres..."
                className="resize-none"
                data-testid="input-void-reason-text"
              />
            </div>
          )}

          {needsPin && (
            <div className="space-y-2">
              <Label>PIN de gerente</Label>
              <div className="flex justify-center gap-1" data-testid="display-void-pin">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-md border flex items-center justify-center text-lg font-bold"
                  >
                    {managerPin[i] ? "\u2022" : ""}
                  </div>
                ))}
              </div>
              {pinError && (
                <p className="text-sm text-destructive text-center" data-testid="text-void-pin-error">{pinError}</p>
              )}
              <div className="grid grid-cols-3 gap-1">
                {["1","2","3","4","5","6","7","8","9","","0",""].map((d, idx) => {
                  if (idx === 9) return <div key="empty1" />;
                  if (idx === 11) {
                    return (
                      <Button
                        key="back"
                        variant="outline"
                        onClick={handlePinBackspace}
                        data-testid="button-void-pin-backspace"
                      >
                        &larr;
                      </Button>
                    );
                  }
                  return (
                    <Button
                      key={d}
                      variant="outline"
                      onClick={() => handlePinDigit(d)}
                      data-testid={`button-void-pin-${d}`}
                    >
                      {d}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {!needsPin && pinError && (
            <p className="text-sm text-destructive" data-testid="text-void-error">{pinError}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-void-cancel">
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit() || voidMutation.isPending}
            onClick={() => voidMutation.mutate()}
            data-testid="button-void-confirm"
          >
            {voidMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Anular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
