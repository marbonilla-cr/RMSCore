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
  Link2,
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
  { title: "QuickBooks", url: "/admin/quickbooks", icon: Link2 },
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
        <div style={{ padding: "14px 0 8px", display: "flex", justifyContent: "center" }}>
          <img src={logoImg} alt="La Antigua Lechería" className="rail-logo-img" data-testid="img-sidebar-logo" />
        </div>

        {showTables && (
          <SidebarGroup>
            <SidebarGroupLabel>Salón</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {tablesItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                  <SidebarMenuButton asChild isActive={location === productsItem.url} tooltip={productsItem.title}>
                    <Link href={productsItem.url} data-testid={`link-${productsItem.url.replace(/\//g, "-").slice(1)}`}>
                      <productsItem.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === productsItem.url} tooltip={productsItem.title}>
                      <Link href={productsItem.url} data-testid={`link-${productsItem.url.replace(/\//g, "-").slice(1)}`}>
                        <productsItem.icon className="w-5 h-5" />
                        <span>{productsItem.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {showHRManage && hrManagerItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url} tooltip={item.title}>
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-5 h-5" />
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)" }} data-testid="text-user-name" title={user?.displayName}>
            {initials}
          </div>
          <button
            onClick={logout}
            data-testid="button-logout"
            style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Salir"
          >
            <LogOut size={14} />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
