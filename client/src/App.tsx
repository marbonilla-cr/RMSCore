import { useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import PinLoginPage from "@/pages/pin-login";
import LoginPage from "@/pages/login";
import EnrollPinPage from "@/pages/enroll-pin";
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
import NotFound from "@/pages/not-found";

function getDefaultRoute(role: string): string {
  switch (role) {
    case "KITCHEN": return "/kds";
    case "CASHIER": return "/pos";
    case "MANAGER": return "/tables";
    case "WAITER":
    default: return "/tables";
  }
}

function canAccessRoute(role: string, path: string): boolean {
  if (role === "MANAGER") return true;

  if (role === "WAITER") {
    return path === "/" || path === "/tables" || path.startsWith("/tables/");
  }
  if (role === "KITCHEN") {
    return path === "/" || path === "/kds";
  }
  if (role === "CASHIER") {
    return path === "/" || path === "/pos";
  }
  return false;
}

function useRoleGuard(allowedRoles: string[]) {
  const { user } = useAuth();
  const allowed = user ? allowedRoles.includes(user.role) : false;

  useEffect(() => {
    if (user && !allowed) {
      const target = getDefaultRoute(user.role);
      window.location.replace(target);
    }
  }, [user, allowed]);

  return allowed;
}

function AuthenticatedRouter() {
  const { user } = useAuth();

  if (!user) return null;

  const role = user.role;
  const path = window.location.pathname;

  if (path === "/" && role !== "WAITER" && role !== "MANAGER") {
    window.location.replace(getDefaultRoute(role));
    return null;
  }

  if (!canAccessRoute(role, path)) {
    const target = getDefaultRoute(role);
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
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 bg-background z-50">
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

  if (!user.hasPin) {
    return <EnrollPinPage />;
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
