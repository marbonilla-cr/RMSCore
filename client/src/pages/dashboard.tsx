import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutDashboard, ShoppingBag, DollarSign,
  TrendingUp, XCircle, Clock, Loader2,
} from "lucide-react";

interface DashboardData {
  openOrders: { count: number; amount: number };
  paidOrders: { count: number; amount: number };
  cancelledOrders: { count: number; amount: number };
  topProducts: { name: string; qty: number; amount: number }[];
  topCategories: { name: string; qty: number; amount: number }[];
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6" /> Dashboard
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-md" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <LayoutDashboard className="w-6 h-6" /> Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Resumen del día</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card data-testid="card-open-orders">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Órdenes Abiertas</span>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{data?.openOrders.count || 0}</p>
            <p className="text-sm text-muted-foreground">₡{(data?.openOrders.amount || 0).toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card data-testid="card-paid-orders">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Órdenes Pagadas</span>
              <DollarSign className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold text-green-600">{data?.paidOrders.count || 0}</p>
            <p className="text-sm text-muted-foreground">₡{(data?.paidOrders.amount || 0).toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card data-testid="card-cancelled-orders">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Canceladas / Anuladas</span>
              <XCircle className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-2xl font-bold">{data?.cancelledOrders.count || 0}</p>
            <p className="text-sm text-muted-foreground">₡{(data?.cancelledOrders.amount || 0).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-top-products">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            <h3 className="font-bold">Top Productos</h3>
          </CardHeader>
          <CardContent>
            {!data?.topProducts || data.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin datos para hoy</p>
            ) : (
              <div className="space-y-3">
                {data.topProducts.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="text-sm font-medium truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">{item.qty} uds</span>
                      <span className="text-sm font-medium">₡{item.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-top-categories">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            <h3 className="font-bold">Top Categorías</h3>
          </CardHeader>
          <CardContent>
            {!data?.topCategories || data.topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin datos para hoy</p>
            ) : (
              <div className="space-y-3">
                {data.topCategories.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="text-sm font-medium truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">{item.qty} uds</span>
                      <span className="text-sm font-medium">₡{item.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
