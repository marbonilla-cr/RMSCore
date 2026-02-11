import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import PinLoginPage from "@/pages/pin-login";
import LoginPage from "@/pages/login";
import TablesPage from "@/pages/tables";
import TableDetailPage from "@/pages/table-detail";
import KDSPage from "@/pages/kds";
import POSPage from "@/pages/pos";
import DashboardPage from "@/pages/dashboard";
import QRClientPage from "@/pages/qr-client";
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
import NotFound from "@/pages/not-found";

function getDefaultRouteByPermissions(perms: string[]): string {
  if (perms.includes("MODULE_TABLES_VIEW")) return "/tables";
  if (perms.includes("MODULE_POS_VIEW")) return "/pos";
  if (perms.includes("MODULE_KDS_VIEW")) return "/kds";
  if (perms.includes("MODULE_DASHBOARD_VIEW")) return "/dashboard";
  if (perms.includes("MODULE_ADMIN_VIEW")) return "/admin/employees";
  return "/tables";
}

function canAccessRouteByPermissions(perms: string[], path: string): boolean {
  if (path === "/") return true;
  if (path === "/tables" || path.startsWith("/tables/")) return perms.includes("MODULE_TABLES_VIEW");
  if (path === "/kds") return perms.includes("MODULE_KDS_VIEW");
  if (path === "/pos") return perms.includes("MODULE_POS_VIEW");
  if (path === "/dashboard") return perms.includes("MODULE_DASHBOARD_VIEW");
  if (path.startsWith("/admin/")) return perms.includes("MODULE_ADMIN_VIEW");
  return false;
}

function NoAccess() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-2">Sin acceso</h2>
        <p className="text-muted-foreground text-sm">No tiene permisos para acceder a este módulo.</p>
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
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { user, logout } = useAuth();
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 bg-background z-[9]">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              {user && (
                <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-current-user">
                  {user.displayName}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                data-testid="button-switch-user"
                onClick={logout}
              >
                <LogOut className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Cambiar usuario</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
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
      <Route component={AppContent} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
