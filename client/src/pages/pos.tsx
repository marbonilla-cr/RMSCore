import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, DollarSign, Loader2, Receipt,
  Banknote, ArrowRight, Lock, Unlock,
} from "lucide-react";
import type { PaymentMethod } from "@shared/schema";

interface POSTable {
  id: number;
  tableName: string;
  orderId: number;
  totalAmount: string;
  itemCount: number;
  items: { id: number; productNameSnapshot: string; qty: number; productPriceSnapshot: string; status: string }[];
}

export default function POSPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("tables");
  const [selectedTable, setSelectedTable] = useState<POSTable | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [cashOpen, setCashOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const { data: posTables = [], isLoading } = useQuery<POSTable[]>({
    queryKey: ["/api/pos/tables"],
    refetchInterval: 10000,
  });

  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ["/api/admin/payment-methods"],
  });

  const { data: cashSession } = useQuery<any>({
    queryKey: ["/api/pos/cash-session"],
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/pos/pay", {
        orderId: selectedTable!.orderId,
        paymentMethodId: parseInt(paymentMethodId),
        amount: selectedTable!.totalAmount,
        clientName: clientName || null,
        clientEmail: clientEmail || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setPaymentOpen(false);
      setSelectedTable(null);
      setClientName("");
      setClientEmail("");
      toast({ title: "Pago procesado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCashMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pos/cash-session/open", { openingCash }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      setCashOpen(false);
      toast({ title: "Caja abierta" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeCashMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pos/cash-session/close", { countedCash, notes: closeNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      setCloseOpen(false);
      toast({ title: "Caja cerrada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <CreditCard className="w-6 h-6" /> POS / Caja
        </h1>
        <div className="flex items-center gap-2">
          {cashSession?.id && !cashSession.closedAt ? (
            <Badge variant="default" className="flex items-center gap-1">
              <Unlock className="w-3 h-3" />
              Caja Abierta
            </Badge>
          ) : (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Caja Cerrada
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="tables" data-testid="tab-pos-tables">Mesas por Cobrar</TabsTrigger>
          <TabsTrigger value="cash" data-testid="tab-cash">Caja</TabsTrigger>
        </TabsList>

        <TabsContent value="tables">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : posTables.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No hay mesas con consumos pendientes de pago</p>
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {posTables.map((t) => (
                <Card key={t.id} data-testid={`card-pos-table-${t.id}`}>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                    <h3 className="font-bold text-lg">{t.tableName}</h3>
                    <Badge>{t.itemCount} items</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                      {t.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm py-1">
                          <span>{item.qty}x {item.productNameSnapshot}</span>
                          <span className="text-muted-foreground">₡{Number(Number(item.productPriceSnapshot) * item.qty).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-3 flex items-center justify-between">
                      <span className="font-bold text-lg">₡{Number(t.totalAmount).toLocaleString()}</span>
                      <Button
                        onClick={() => { setSelectedTable(t); setPaymentOpen(true); }}
                        disabled={!cashSession?.id || !!cashSession.closedAt}
                        data-testid={`button-pay-table-${t.id}`}
                      >
                        <Banknote className="w-4 h-4 mr-1" /> Cobrar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cash">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <h3 className="font-bold">Sesión de Caja</h3>
              </CardHeader>
              <CardContent>
                {cashSession?.id && !cashSession.closedAt ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Apertura</span>
                      <span className="font-medium">₡{Number(cashSession.openingCash).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Efectivo Esperado</span>
                      <span className="font-medium">₡{Number(cashSession.expectedCash || 0).toLocaleString()}</span>
                    </div>
                    <Button variant="destructive" className="w-full mt-4" onClick={() => setCloseOpen(true)} data-testid="button-close-cash">
                      <Lock className="w-4 h-4 mr-1" /> Cerrar Caja
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">No hay sesión de caja abierta</p>
                    <Button className="w-full" onClick={() => setCashOpen(true)} data-testid="button-open-cash">
                      <Unlock className="w-4 h-4 mr-1" /> Abrir Caja
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {cashSession?.closedAt && (
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="font-bold">Último Cierre</h3>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Apertura</span>
                    <span>₡{Number(cashSession.openingCash).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Esperado</span>
                    <span>₡{Number(cashSession.expectedCash || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Contado</span>
                    <span>₡{Number(cashSession.countedCash || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-2">
                    <span>Diferencia</span>
                    <span className={Number(cashSession.difference || 0) < 0 ? "text-destructive" : ""}>
                      ₡{Number(cashSession.difference || 0).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobrar - {selectedTable?.tableName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-3xl font-bold" data-testid="text-payment-total">₡{Number(selectedTable?.totalAmount || 0).toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">{selectedTable?.itemCount} items</p>
            </div>
            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue placeholder="Seleccionar método" />
                </SelectTrigger>
                <SelectContent>
                  {activePaymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.paymentName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nombre del Cliente (opcional)</Label>
              <Input data-testid="input-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre" />
            </div>
            <div className="space-y-2">
              <Label>Email (opcional)</Label>
              <Input data-testid="input-client-email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@example.com" type="email" />
            </div>
            <Button className="w-full" onClick={() => payMutation.mutate()} disabled={!paymentMethodId || payMutation.isPending} data-testid="button-process-payment">
              {payMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <DollarSign className="w-4 h-4 mr-1" />}
              Procesar Pago
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Abrir Caja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Monto Inicial en Efectivo</Label>
              <Input data-testid="input-opening-cash" type="number" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0.00" />
            </div>
            <Button className="w-full" onClick={() => openCashMutation.mutate()} disabled={openCashMutation.isPending} data-testid="button-confirm-open-cash">
              {openCashMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Abrir Caja
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cerrar Caja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Efectivo Contado</Label>
              <Input data-testid="input-counted-cash" type="number" step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Observaciones del cierre" />
            </div>
            <Button variant="destructive" className="w-full" onClick={() => closeCashMutation.mutate()} disabled={closeCashMutation.isPending} data-testid="button-confirm-close-cash">
              {closeCashMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Confirmar Cierre
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
