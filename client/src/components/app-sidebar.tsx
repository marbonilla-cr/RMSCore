import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  ChefHat,
  CreditCard,
  Settings,
  Grid3x3,
  Tag,
  ShoppingBag,
  Wallet,
  LogOut,
  Building2,
  Printer,
  UserCog,
  Shield,
  Settings2,
  Percent,
  Receipt,
  Wine,
  Clock,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Wrench,
  Package,
  Truck,
  FileText,
  ClipboardCheck,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  List,
} from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_1770666183401.png";

const tablesItems = [
  { title: "Mesas", url: "/tables", icon: Grid3x3 },
];

const kitchenItems = [
  { title: "Cocina (KDS)", url: "/kds", icon: ChefHat },
  { title: "Bar (KDS)", url: "/kds-bar", icon: Wine },
];

const cashierItems = [
  { title: "POS / Caja", url: "/pos", icon: CreditCard },
];

const dashboardItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Cubo de Ventas", url: "/reports/sales-cube", icon: BarChart3 },
];

const adminItems = [
  { title: "Empleados", url: "/admin/employees", icon: UserCog },
  { title: "Roles y Permisos", url: "/admin/roles", icon: Shield },
  { title: "Mesas", url: "/admin/tables", icon: Grid3x3 },
  { title: "Categorías", url: "/admin/categories", icon: Tag },
  { title: "Modificadores", url: "/admin/modifiers", icon: Settings2 },
  { title: "Descuentos", url: "/admin/discounts", icon: Percent },
  { title: "Impuestos", url: "/admin/tax-categories", icon: Receipt },
  { title: "Métodos de Pago", url: "/admin/payment-methods", icon: Wallet },
  { title: "Config. Negocio", url: "/admin/business-config", icon: Building2 },
  { title: "Impresoras", url: "/admin/printers", icon: Printer },
];

const productsItem = { title: "Productos", url: "/admin/products", icon: ShoppingBag };

const hrSelfItems = [
  { title: "Mi Turno", url: "/hr/mi-turno", icon: Clock },
];

const invItems = [
  { title: "Insumos", url: "/inventory/items", icon: Package },
  { title: "Proveedores", url: "/inventory/suppliers", icon: Truck },
  { title: "Órdenes de Compra", url: "/inventory/purchase-orders", icon: FileText },
  { title: "Conteo Físico", url: "/inventory/physical-counts", icon: ClipboardCheck },
  { title: "Recetas / BOM", url: "/inventory/recipes", icon: BookOpen },
  { title: "Reportes", url: "/inventory/reports", icon: TrendingUp },
];

const shortageItems = [
  { title: "Reportar Faltante", url: "/shortages/report", icon: AlertTriangle },
  { title: "Faltantes Activos", url: "/shortages/active", icon: List },
  { title: "Auditoría", url: "/shortages/audit", icon: Shield },
];

const hrManagerItems = [
  { title: "Horarios", url: "/hr/horarios", icon: CalendarDays },
  { title: "Marcas", url: "/hr/marcas", icon: ClipboardList },
  { title: "Reportes", url: "/hr/reportes", icon: BarChart3 },
  { title: "Config HR", url: "/hr/config", icon: Wrench },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { hasPermission } = usePermissions();

  const showTables = hasPermission("MODULE_TABLES_VIEW");
  const showKDS = hasPermission("MODULE_KDS_VIEW");
  const showPOS = hasPermission("MODULE_POS_VIEW");
  const showDashboard = hasPermission("MODULE_DASHBOARD_VIEW");
  const showAdmin = hasPermission("MODULE_ADMIN_VIEW");
  const showProducts = hasPermission("MODULE_PRODUCTS_VIEW");
  const showHR = hasPermission("MODULE_HR_VIEW");
  const showHRManage = hasPermission("HR_MANAGE_SCHEDULES") || hasPermission("HR_VIEW_TEAM") || hasPermission("HR_MANAGE_SETTINGS");
  const showINV = hasPermission("MODULE_INV_VIEW");
  const showShortages = hasPermission("SHORTAGES_VIEW");

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <Sidebar>
      <SidebarContent>
        <div style={{ padding: "16px 16px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={logoImg} alt="La Antigua Lechería" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} data-testid="img-sidebar-logo" />
            <span style={{ fontFamily: "var(--f-disp)", fontSize: 14, fontWeight: 800, color: "var(--text)", letterSpacing: "0.02em" }}>La Antigua Lechería</span>
          </div>
        </div>

        {showTables && (
          <SidebarGroup>
            <SidebarGroupLabel>Salón</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {tablesItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showKDS && (
          <SidebarGroup>
            <SidebarGroupLabel>Cocina / Bar</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {kitchenItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showPOS && (
          <SidebarGroup>
            <SidebarGroupLabel>Caja</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {cashierItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showDashboard && (
          <SidebarGroup>
            <SidebarGroupLabel>Gerencia</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {dashboardItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showProducts && !showAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Menú</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === productsItem.url}>
                    <Link href={productsItem.url} data-testid={`link-${productsItem.url.replace(/\//g, "-").slice(1)}`}>
                      <productsItem.icon className="w-4 h-4" />
                      <span>{productsItem.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Settings className="w-3 h-3 mr-1 inline" />
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {showProducts && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === productsItem.url}>
                      <Link href={productsItem.url} data-testid={`link-${productsItem.url.replace(/\//g, "-").slice(1)}`}>
                        <productsItem.icon className="w-4 h-4" />
                        <span>{productsItem.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showINV && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Package className="w-3 h-3 mr-1 inline" />
              Inventario
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {invItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showShortages && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <AlertTriangle className="w-3 h-3 mr-1 inline" />
              Faltantes
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {shortageItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showHR && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Clock className="w-3 h-3 mr-1 inline" />
              Recursos Humanos
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {hrSelfItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {showHRManage && hrManagerItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 p-2">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">{user?.displayName}</p>
            <p className="text-xs text-muted-foreground" data-testid="text-user-role">{user?.role}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={logout} data-testid="button-logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
