import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Gift, Users, Search, Star, TrendingUp, Settings, MessageSquare } from "lucide-react";

interface ReviewRow {
  id: number;
  orderId: number;
  rating: number;
  comment: string | null;
  customerName: string | null;
  orderMode: string;
  businessDate: string | null;
  createdAt: string;
}

interface ReviewsResponse {
  reviews: ReviewRow[];
  avg: string | null;
  total: number;
}

interface LoyaltyConfig {
  id?: number;
  tenantId: number;
  isActive: boolean;
  earnRate: string;
  minRedeemPoints: string;
  redeemRate: string;
  pointsExpiryDays: number;
}

interface CustomerRow {
  id: number;
  name: string;
  email: string;
  photo_url?: string;
  phone?: string;
  points_balance: string;
  lifetime_points: string;
  last_activity?: string;
}

export default function AdminLoyaltyPage() {
  const { toast } = useToast();
  const [searchQ, setSearchQ] = useState("");
  const [tab, setTab] = useState<"config" | "customers" | "reviews">("config");

  const { data: config, isLoading: configLoading } = useQuery<LoyaltyConfig | null>({
    queryKey: ["/api/loyalty/config"],
  });

  const { data: customers, isLoading: customersLoading } = useQuery<CustomerRow[]>({
    queryKey: ["/api/loyalty/customers"],
    enabled: tab === "customers",
  });

  const { data: searchResults } = useQuery<CustomerRow[]>({
    queryKey: [`/api/loyalty/customers/search?q=${encodeURIComponent(searchQ)}`],
    enabled: searchQ.length >= 2,
  });

  const [form, setForm] = useState({
    isActive: false,
    earnRate: "2.00",
    minRedeemPoints: "500",
    redeemRate: "1.0000",
    pointsExpiryDays: 0,
  });

  useEffect(() => {
    if (config) {
      setForm({
        isActive: config.isActive,
        earnRate: config.earnRate || "2.00",
        minRedeemPoints: config.minRedeemPoints || "500",
        redeemRate: config.redeemRate || "1.0000",
        pointsExpiryDays: config.pointsExpiryDays ?? 0,
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return apiRequest("PUT", "/api/loyalty/config", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loyalty/config"] });
      toast({ title: "Configuración de loyalty guardada" });
    },
    onError: (err: any) => {
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    },
  });

  const displayCustomers = searchQ.length >= 2 ? (searchResults || []) : (customers || []);

  const { data: reviewsData, isLoading: reviewsLoading } = useQuery<ReviewsResponse>({
    queryKey: ["/api/admin/reviews"],
    enabled: tab === "reviews",
  });

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Gift className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-loyalty-title">Loyalty & Reseñas</h1>
          <p className="text-sm text-muted-foreground">Gestiona puntos, configuración, clientes y reseñas</p>
        </div>
        {config?.isActive && (
          <Badge className="ml-auto" data-testid="badge-loyalty-active">Activo</Badge>
        )}
        {config && !config.isActive && (
          <Badge variant="secondary" className="ml-auto" data-testid="badge-loyalty-inactive">Inactivo</Badge>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={tab === "config" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("config")}
          data-testid="button-tab-config"
        >
          <Settings className="w-4 h-4 mr-1" /> Configuración
        </Button>
        <Button
          variant={tab === "customers" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("customers")}
          data-testid="button-tab-customers"
        >
          <Users className="w-4 h-4 mr-1" /> Clientes
        </Button>
        <Button
          variant={tab === "reviews" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("reviews")}
          data-testid="button-tab-reviews"
        >
          <MessageSquare className="w-4 h-4 mr-1" /> Reseñas
        </Button>
      </div>

      {tab === "config" && (
        <>
          {configLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold">Parámetros del Programa</h2>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">Programa Activo</p>
                    <p className="text-xs text-muted-foreground">Habilita acumulación y redención de puntos</p>
                  </div>
                  <Switch
                    data-testid="switch-loyalty-active"
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="earnRate">Tasa de Acumulación (%)</Label>
                    <Input
                      id="earnRate"
                      data-testid="input-earn-rate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.earnRate}
                      onChange={(e) => setForm({ ...form, earnRate: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Puntos por cada ₡100 gastados</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="redeemRate">Valor del Punto (₡ por punto)</Label>
                    <Input
                      id="redeemRate"
                      data-testid="input-redeem-rate"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={form.redeemRate}
                      onChange={(e) => setForm({ ...form, redeemRate: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">₡ de descuento por cada punto redimido</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="minRedeemPoints">Mínimo para Redimir (puntos)</Label>
                    <Input
                      id="minRedeemPoints"
                      data-testid="input-min-redeem"
                      type="number"
                      min="0"
                      value={form.minRedeemPoints}
                      onChange={(e) => setForm({ ...form, minRedeemPoints: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="expiryDays">Días de Expiración (0 = sin expiración)</Label>
                    <Input
                      id="expiryDays"
                      data-testid="input-expiry-days"
                      type="number"
                      min="0"
                      value={form.pointsExpiryDays}
                      onChange={(e) => setForm({ ...form, pointsExpiryDays: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => saveMutation.mutate(form)}
                    disabled={saveMutation.isPending}
                    data-testid="button-save-loyalty-config"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Guardar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "customers" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <TrendingUp className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Clientes Registrados</h2>
              <div className="ml-auto flex items-center gap-2 w-full sm:w-auto">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  data-testid="input-customer-search"
                  placeholder="Buscar por nombre o email..."
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  className="w-full sm:w-56"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {customersLoading && searchQ.length < 2 ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : displayCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-customers">
                {searchQ.length >= 2 ? "Sin resultados" : "No hay clientes con puntos aún"}
              </p>
            ) : (
              <div className="space-y-2">
                {displayCustomers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                    data-testid={`row-customer-${c.id}`}
                  >
                    {c.photo_url ? (
                      <img src={c.photo_url} alt={c.name} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-customer-name-${c.id}`}>{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold" data-testid={`text-points-balance-${c.id}`}>
                        {parseFloat(c.points_balance || "0").toLocaleString()} pts
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {parseFloat(c.lifetime_points || "0").toLocaleString()} totales
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "reviews" && (
        <div className="space-y-4">
          {reviewsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !reviewsData || reviewsData.total === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-reviews">
                  Aún no hay reseñas de clientes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="text-center">
                      <p className="text-3xl font-bold" data-testid="text-avg-rating">
                        {reviewsData.avg ? parseFloat(reviewsData.avg).toFixed(1) : "—"}
                      </p>
                      <div className="flex gap-0.5 justify-center mt-1">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} size={14} style={{
                            color: reviewsData.avg && s <= Math.round(parseFloat(reviewsData.avg)) ? "#f59e0b" : "#e5e7eb",
                            fill: reviewsData.avg && s <= Math.round(parseFloat(reviewsData.avg)) ? "#f59e0b" : "none",
                          }} />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Promedio</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold" data-testid="text-total-reviews">{reviewsData.total}</p>
                      <p className="text-xs text-muted-foreground mt-1">Total reseñas</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {reviewsData.reviews.map((r) => (
                  <Card key={r.id} data-testid={`card-review-${r.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex gap-0.5">
                              {[1,2,3,4,5].map(s => (
                                <Star key={s} size={14} style={{
                                  color: s <= r.rating ? "#f59e0b" : "#e5e7eb",
                                  fill: s <= r.rating ? "#f59e0b" : "none",
                                }} />
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">
                              {r.customerName || "Anónimo"}
                            </span>
                            <Badge variant="outline" className="text-xs ml-auto">
                              {r.orderMode === "DISPATCH" ? "Despacho" : "Mesa"}
                            </Badge>
                          </div>
                          {r.comment && (
                            <p className="text-sm mt-1 text-muted-foreground" data-testid={`text-review-comment-${r.id}`}>
                              "{r.comment}"
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Orden #{r.orderId} · {r.businessDate || new Date(r.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
