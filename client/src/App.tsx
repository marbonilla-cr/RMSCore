import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2 } from "lucide-react";
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
import AdminUsersPage from "@/pages/admin/users";
import NotFound from "@/pages/not-found";

function AuthenticatedRouter() {
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
      <Route path="/admin/users" component={AdminUsersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-2 border-b sticky top-0 bg-background z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
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
