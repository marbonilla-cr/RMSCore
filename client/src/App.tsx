import React, { useState, useEffect, Suspense } from "react";
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
import { startKeepAlive } from "@/lib/keepalive";
import { startPrintBridgeClient, stopPrintBridgeClient, isPrintBridgeAvailable } from "@/lib/print-bridge-client";
import PinLoginPage from "@/pages/pin-login";
import LoginPage from "@/pages/login";
import AuthPage from "@/pages/auth-page";
import NotFound from "@/pages/not-found";

const ResetPasswordPage    = React.lazy(() => import("@/pages/reset-password"));
const TablesPage           = React.lazy(() => import("@/pages/tables"));
const TableDetailPage      = React.lazy(() => import("@/pages/table-detail"));
const KDSPage              = React.lazy(() => import("@/pages/kds"));
const KDSBarPage           = React.lazy(() => import("@/pages/kds-bar"));
const POSPage              = React.lazy(() => import("@/pages/pos"));
const DashboardPage        = React.lazy(() => import("@/pages/dashboard"));
const QRClientPage         = React.lazy(() => import("@/pages/qr-client"));
const PublicReservePage    = React.lazy(() => import("@/pages/reserve"));
const PublicMenuPage       = React.lazy(() => import("@/pages/public-menu"));
const SuperadminPage       = React.lazy(() => import("@/pages/superadmin"));
const AdminTablesPage      = React.lazy(() => import("@/pages/admin/tables"));
const AdminCategoriesPage  = React.lazy(() => import("@/pages/admin/categories"));
const AdminProductsPage    = React.lazy(() => import("@/pages/admin/products"));
const AdminPaymentMethodsPage = React.lazy(() => import("@/pages/admin/payment-methods"));
const AdminEmployeesPage   = React.lazy(() => import("@/pages/admin/employees"));
const AdminRolesPage       = React.lazy(() => import("@/pages/admin/roles"));
const AdminBusinessConfigPage = React.lazy(() => import("@/pages/admin/business-config"));
const AdminPrintersPage    = React.lazy(() => import("@/pages/admin/printers"));
const AdminModifiersPage   = React.lazy(() => import("@/pages/admin/modifiers"));
const AdminDiscountsPage   = React.lazy(() => import("@/pages/admin/discounts"));
const AdminTaxCategoriesPage = React.lazy(() => import("@/pages/admin/tax-categories"));
const AdminQuickBooksPage  = React.lazy(() => import("@/pages/admin/quickbooks"));
const DataLoaderPage       = React.lazy(() => import("@/pages/admin/data-loader"));
const AdminLoyaltyPage     = React.lazy(() => import("@/pages/admin/loyalty"));
const HrMiTurnoPage        = React.lazy(() => import("@/pages/hr/mi-turno"));
const HrSchedulesPage      = React.lazy(() => import("@/pages/hr/schedules"));
const HrPunchesPage        = React.lazy(() => import("@/pages/hr/punches"));
const HrReportsPage        = React.lazy(() => import("@/pages/hr/reports"));
const HrSettingsPage       = React.lazy(() => import("@/pages/hr/settings"));
const InvItemsPage         = React.lazy(() => import("@/pages/inventory/items"));
const InvItemDetailPage    = React.lazy(() => import("@/pages/inventory/item-detail"));
const InvSuppliersPage     = React.lazy(() => import("@/pages/inventory/suppliers"));
const InvPurchaseOrdersPage = React.lazy(() => import("@/pages/inventory/purchase-orders"));
const InvPhysicalCountsPage = React.lazy(() => import("@/pages/inventory/physical-counts"));
const InvRecipesPage       = React.lazy(() => import("@/pages/inventory/recipes"));
const InvReportsPage       = React.lazy(() => import("@/pages/inventory/reports"));
const QboLedgerPage        = React.lazy(() => import("@/pages/dashboard/qbo-ledger"));
const InvConversionsPage   = React.lazy(() => import("@/pages/inventory/conversions"));
const InvProductionPage    = React.lazy(() => import("@/pages/inventory/production"));
const InvStockPage         = React.lazy(() => import("@/pages/inventory/stock"));
const InventoryBasicPage   = React.lazy(() => import("@/pages/inventory-basic"));
const ShortagesReportPage  = React.lazy(() => import("@/pages/shortages/report"));
const ShortagesActivePage  = React.lazy(() => import("@/pages/shortages/active"));
const ShortagesAuditPage   = React.lazy(() => import("@/pages/shortages/audit"));
const SalesCubePage        = React.lazy(() => import("@/pages/sales-cube"));

const PageLoader = () => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--background)"
  }}>
    <div style={{
      width: 32,
      height: 32,
      border: "3px solid var(--border)",
      borderTopColor: "var(--primary)",
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite"
    }} />
  </div>
);

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

  useEffect(() => {
    if (user && isPrintBridgeAvailable()) startPrintBridgeClient();
    return () => stopPrintBridgeClient();
  }, [user]);

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
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={TablesPage} />
        <Route path="/tables" component={TablesPage} />
        <Route path="/tables/quick/:orderId" component={TableDetailPage} />
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
        <Route path="/admin/data-loader" component={DataLoaderPage} />
        <Route path="/admin/loyalty" component={AdminLoyaltyPage} />
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
        <Route path="/reports/qbo-ledger" component={QboLedgerPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return <AuthenticatedLayout />;
}

function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/qr/:tableCode" component={QRClientPage} />
        <Route path="/reserve" component={PublicReservePage} />
        <Route path="/menu" component={PublicMenuPage} />
        <Route path="/superadmin" component={SuperadminPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route component={AppContent} />
      </Switch>
    </Suspense>
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

  useEffect(() => {
    startKeepAlive();
  }, []);

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
