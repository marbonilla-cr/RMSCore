import { useState, useEffect } from "react";
import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useShortageAlerts } from "@/hooks/use-shortage-alerts";
import { AppSidebar, DrawerProvider, DrawerTrigger } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePreventPullRefresh } from "@/hooks/use-prevent-pull-refresh";
import { Loader2, LogOut, RefreshCw, Grid3x3, CreditCard, ChefHat, Wine } from "lucide-react";
import { Button } from "@/components/ui/button";
import PinLoginPage from "@/pages/pin-login";
import LoginPage from "@/pages/login";
import TablesPage from "@/pages/tables";
import TableDetailPage from "@/pages/table-detail";
import KDSPage from "@/pages/kds";
import KDSBarPage from "@/pages/kds-bar";
import POSPage from "@/pages/pos";
import DashboardPage from "@/pages/dashboard";
import QRClientPage from "@/pages/qr-client";
import PublicReservePage from "@/pages/reserve";
import PublicMenuPage from "@/pages/public-menu";
import SuperadminPage from "@/pages/superadmin";
import AdminTablesPage from "@/pages/admin/tables";
import AdminCategoriesPage from "@/pages/admin/categories";
import AdminProductsPage from "@/pages/admin/products";
import AdminPaymentMethodsPage from "@/pages/admin/payment-methods";
import AdminEmployeesPage from "@/pages/admin/employees";
import AdminRolesPage from "@/pages/admin/roles";
import AdminBusinessConfigPage from "@/pages/admin/business-config";
import AdminPrintersPage from "@/pages/admin/printers";
import AdminModifiersPage from "@/pages/admin/modifiers";
import AdminDiscountsPage from "@/pages/admin/discounts";
import AdminTaxCategoriesPage from "@/pages/admin/tax-categories";
import HrMiTurnoPage from "@/pages/hr/mi-turno";
import HrSchedulesPage from "@/pages/hr/schedules";
import HrPunchesPage from "@/pages/hr/punches";
import HrReportsPage from "@/pages/hr/reports";
import HrSettingsPage from "@/pages/hr/settings";
import InvItemsPage from "@/pages/inventory/items";
import InvItemDetailPage from "@/pages/inventory/item-detail";
import InvSuppliersPage from "@/pages/inventory/suppliers";
import InvPurchaseOrdersPage from "@/pages/inventory/purchase-orders";
import InvPhysicalCountsPage from "@/pages/inventory/physical-counts";
import InvRecipesPage from "@/pages/inventory/recipes";
import InvReportsPage from "@/pages/inventory/reports";
import InvConversionsPage from "@/pages/inventory/conversions";
import InvProductionPage from "@/pages/inventory/production";
import InvStockPage from "@/pages/inventory/stock";
import InventoryBasicPage from "@/pages/inventory-basic";
import ShortagesReportPage from "@/pages/shortages/report";
import ShortagesActivePage from "@/pages/shortages/active";
import ShortagesAuditPage from "@/pages/shortages/audit";
import SalesCubePage from "@/pages/sales-cube";
import AdminQuickBooksPage from "@/pages/admin/quickbooks";
import NotFound from "@/pages/not-found";

function getDefaultRouteByPermissions(perms: string[]): string {
  if (perms.includes("MODULE_TABLES_VIEW")) return "/tables";
  if (perms.includes("MODULE_POS_VIEW")) return "/pos";
  if (perms.includes("MODULE_KDS_VIEW")) return "/kds";
  if (perms.includes("MODULE_DASHBOARD_VIEW")) return "/dashboard";
  if (perms.includes("MODULE_ADMIN_VIEW")) return "/admin/employees";
  if (perms.includes("MODULE_HR_VIEW")) return "/hr/mi-turno";
  if (perms.includes("MODULE_PRODUCTS_VIEW")) return "/admin/products";
  return "/tables";
}

function canAccessRouteByPermissions(perms: string[], path: string): boolean {
  if (path === "/") return true;
  if (path === "/tables" || path.startsWith("/tables/")) return perms.includes("MODULE_TABLES_VIEW");
  if (path === "/kds" || path === "/kds-bar") return perms.includes("MODULE_KDS_VIEW");
  if (path === "/pos") return perms.includes("MODULE_POS_VIEW");
  if (path === "/dashboard") return perms.includes("MODULE_DASHBOARD_VIEW");
  if (path === "/admin/products") return perms.includes("MODULE_PRODUCTS_VIEW");
  if (path.startsWith("/admin/")) return perms.includes("MODULE_ADMIN_VIEW");
  if (path.startsWith("/hr/")) return perms.includes("MODULE_HR_VIEW");
  if (path.startsWith("/inventory/")) return perms.includes("MODULE_INV_VIEW");
  if (path.startsWith("/shortages/")) return perms.includes("SHORTAGES_VIEW");
  if (path.startsWith("/reports/")) return perms.includes("MODULE_DASHBOARD_VIEW");
  return false;
}

function NoAccess() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 32 }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontFamily: "var(--f-disp)", fontSize: 18, fontWeight: 800, marginBottom: 8, color: "var(--text)" }}>Sin acceso</h2>
        <p style={{ fontFamily: "var(--f-body)", fontSize: 14, color: "var(--text3)" }}>No tiene permisos para acceder a este módulo.</p>
      </div>
    </div>
  );
}

function AuthenticatedRouter() {
  const { user } = useAuth();
  const { permissions, isLoading: permsLoading } = usePermissions();

  if (!user) return null;
  if (permsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const path = window.location.pathname;

  if (path === "/") {
    const target = getDefaultRouteByPermissions(permissions);
    if (target !== "/tables") {
      window.location.replace(target);
      return null;
    }
  }

  if (!canAccessRouteByPermissions(permissions, path)) {
    const target = getDefaultRouteByPermissions(permissions);
    window.location.replace(target);
    return null;
  }

  return (
    <Switch>
      <Route path="/" component={TablesPage} />
      <Route path="/tables" component={TablesPage} />
      <Route path="/tables/:id" component={TableDetailPage} />
      <Route path="/kds" component={KDSPage} />
      <Route path="/kds-bar" component={KDSBarPage} />
      <Route path="/pos" component={POSPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/admin/tables" component={AdminTablesPage} />
      <Route path="/admin/categories" component={AdminCategoriesPage} />
      <Route path="/admin/products" component={AdminProductsPage} />
      <Route path="/admin/payment-methods" component={AdminPaymentMethodsPage} />
      <Route path="/admin/employees" component={AdminEmployeesPage} />
      <Route path="/admin/roles" component={AdminRolesPage} />
      <Route path="/admin/business-config" component={AdminBusinessConfigPage} />
      <Route path="/admin/printers" component={AdminPrintersPage} />
      <Route path="/admin/modifiers" component={AdminModifiersPage} />
      <Route path="/admin/discounts" component={AdminDiscountsPage} />
      <Route path="/admin/tax-categories" component={AdminTaxCategoriesPage} />
      <Route path="/admin/quickbooks" component={AdminQuickBooksPage} />
      <Route path="/hr/mi-turno" component={HrMiTurnoPage} />
      <Route path="/hr/horarios" component={HrSchedulesPage} />
      <Route path="/hr/marcas" component={HrPunchesPage} />
      <Route path="/hr/reportes" component={HrReportsPage} />
      <Route path="/hr/config" component={HrSettingsPage} />
      <Route path="/inventory/basic" component={InventoryBasicPage} />
      <Route path="/inventory/items" component={InvItemsPage} />
      <Route path="/inventory/items/:id" component={InvItemDetailPage} />
      <Route path="/inventory/suppliers" component={InvSuppliersPage} />
      <Route path="/inventory/purchase-orders" component={InvPurchaseOrdersPage} />
      <Route path="/inventory/physical-counts" component={InvPhysicalCountsPage} />
      <Route path="/inventory/recipes" component={InvRecipesPage} />
      <Route path="/inventory/conversions" component={InvConversionsPage} />
      <Route path="/inventory/production" component={InvProductionPage} />
      <Route path="/inventory/stock" component={InvStockPage} />
      <Route path="/inventory/reports" component={InvReportsPage} />
      <Route path="/shortages/report" component={ShortagesReportPage} />
      <Route path="/shortages/active" component={ShortagesActivePage} />
      <Route path="/shortages/audit" component={ShortagesAuditPage} />
      <Route path="/reports/sales-cube" component={SalesCubePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function QuickNavButtons() {
  const { hasPermission } = usePermissions();
  const [location] = useLocation();
  const showTables = hasPermission("MODULE_TABLES_VIEW");
  const showPOS = hasPermission("MODULE_POS_VIEW");
  const showKDS = hasPermission("MODULE_KDS_VIEW");
  const navItems = [
    ...(showTables ? [{ url: "/tables", label: "Mesas", icon: Grid3x3 }] : []),
    ...(showPOS ? [{ url: "/pos", label: "Caja", icon: CreditCard }] : []),
    ...(showKDS ? [
      { url: "/kds", label: "Cocina", icon: ChefHat },
      { url: "/kds-bar", label: "Bar", icon: Wine },
    ] : []),
  ];

  if (navItems.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {navItems.map(item => {
        const active = location === item.url || location.startsWith(item.url + "/");
        const Icon = item.icon;
        return (
          <Link key={item.url} href={item.url}>
            <Button
              variant={active ? "default" : "ghost"}
              size="sm"
              data-testid={`quicknav-${item.url.replace(/\//g, "-").slice(1)}`}
              className="flex flex-col items-center gap-0 h-auto py-1 px-2 min-w-[44px]"
            >
              <Icon size={16} />
              <span className="text-[10px] leading-tight">{item.label}</span>
            </Button>
          </Link>
        );
      })}
    </div>
  );
}

function AuthenticatedLayout() {
  const { user, logout } = useAuth();
  useShortageAlerts();
  return (
    <DrawerProvider>
      <style>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          padding: 6px 12px;
          background: var(--s0);
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          z-index: 9;
        }
        .app-header-left,
        .app-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
      
      `}</style>
      <AppSidebar />
      <div className="flex flex-col h-screen w-full">
        <header className="app-header">
          <div className="app-header-left">
            <DrawerTrigger />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.location.reload()}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
          <QuickNavButtons />
          <div className="app-header-right">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              data-testid="button-switch-user"
              onClick={logout}
              title="Cambiar usuario"
              className="h-8 w-8"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <AuthenticatedRouter />
        </main>
      </div>
    </DrawerProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    if (showPasswordLogin) {
      return (
        <div>
          <LoginPage />
          <div className="fixed bottom-4 left-0 right-0 text-center">
            <button
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-pin-login"
              onClick={() => setShowPasswordLogin(false)}
            >
              Volver a PIN
            </button>
          </div>
        </div>
      );
    }
    return <PinLoginPage onSwitchToPassword={() => setShowPasswordLogin(true)} />;
  }

  return <AuthenticatedLayout />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/qr/:tableCode" component={QRClientPage} />
      <Route path="/reserve" component={PublicReservePage} />
      <Route path="/menu" component={PublicMenuPage} />
      <Route path="/superadmin" component={SuperadminPage} />
      <Route component={AppContent} />
    </Switch>
  );
}

function useWakeLock() {
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    async function requestWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch (_) {}
    }

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wakeLock?.release();
    };
  }, []);
}

function App() {
  useWakeLock();
  usePreventPullRefresh();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
