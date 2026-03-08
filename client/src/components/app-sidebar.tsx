import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  Boxes,
  Link2,
  List,
  Menu,
  ArrowRightLeft,
  Factory,
  Database,
} from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";

type DrawerContextType = {
  open: boolean;
  setOpen: (v: boolean) => void;
};

const DrawerContext = createContext<DrawerContextType>({ open: false, setOpen: () => {} });

export function useDrawer() {
  return useContext(DrawerContext);
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const prevLocationRef = useRef(location);

  useEffect(() => {
    if (prevLocationRef.current !== location) {
      prevLocationRef.current = location;
      setOpen(false);
    }
  }, [location]);

  return (
    <DrawerContext.Provider value={{ open, setOpen }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function DrawerTrigger({ className }: { className?: string }) {
  const { setOpen } = useDrawer();
  return (
    <button
      onClick={() => setOpen(true)}
      className={className}
      data-testid="button-sidebar-toggle"
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 6,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text2)",
      }}
    >
      <Menu size={20} />
    </button>
  );
}

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
  { title: "Ledger QBO", url: "/reports/qbo-ledger", icon: FileText },
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
  { title: "Inventario Básico", url: "/inventory/basic", icon: Boxes },
  { title: "Insumos", url: "/inventory/items", icon: Package },
  { title: "Conversiones AP→EP", url: "/inventory/conversions", icon: ArrowRightLeft },
  { title: "Producción", url: "/inventory/production", icon: Factory },
  { title: "Stock", url: "/inventory/stock", icon: Database },
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

type NavItem = { title: string; url: string; icon: any };

function NavGroup({ label, labelIcon, items, location, onNav, checkPrefix }: {
  label: string;
  labelIcon?: any;
  items: NavItem[];
  location: string;
  onNav: () => void;
  checkPrefix?: boolean;
}) {
  const LabelIcon = labelIcon;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.4)", padding: "10px 16px 4px", display: "flex", alignItems: "center", gap: 4,
      }}>
        {LabelIcon && <LabelIcon size={13} />}
        {label}
      </div>
      {items.map(item => {
        const active = checkPrefix
          ? (location === item.url || location.startsWith(item.url + "/"))
          : location === item.url;
        return (
          <Link
            key={item.url}
            href={item.url}
            onClick={onNav}
            data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 16px", textDecoration: "none",
              color: active ? "#fff" : "rgba(255,255,255,0.75)",
              background: active ? "rgba(255,255,255,0.12)" : "transparent",
              borderRadius: 6, margin: "1px 8px",
              fontSize: 14, fontFamily: "var(--f-body)",
              transition: "background 0.15s",
            }}
          >
            <item.icon size={18} style={{ flexShrink: 0 }} />
            <span>{item.title}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { hasPermission } = usePermissions();
  const { open, setOpen } = useDrawer();

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
  const showShortagesManage = hasPermission("SHORTAGES_CLOSE");

  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const close = useCallback(() => setOpen(false), [setOpen]);

  const allAdminItems = [
    ...(showProducts ? [productsItem] : []),
    ...adminItems,
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        className="p-0 border-r-0 [&>button.absolute]:hidden"
        style={{
          width: 280,
          maxWidth: "85vw",
          background: "hsl(34, 33%, 5%)",
          color: "#fff",
        }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Menú</SheetTitle>
          <SheetDescription>Navegación del sistema</SheetDescription>
        </SheetHeader>

        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "16px 0 8px", display: "flex", justifyContent: "center" }}>
            <img
              src={logoImg}
              alt="La Antigua Lechería"
              style={{ height: 48, objectFit: "contain" }}
              data-testid="img-sidebar-logo"
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {showDashboard && (
              <NavGroup label="Gerencia" items={dashboardItems} location={location} onNav={close} />
            )}
            {showTables && (
              <NavGroup label="Mesas" labelIcon={Grid3x3} items={tablesItems} location={location} onNav={close} />
            )}
            {showPOS && (
              <NavGroup label="Caja" labelIcon={CreditCard} items={cashierItems} location={location} onNav={close} />
            )}
            {showKDS && (
              <NavGroup label="Cocina / Bar" labelIcon={ChefHat} items={kitchenItems} location={location} onNav={close} />
            )}
            {showProducts && !showAdmin && (
              <NavGroup label="Menú" items={[productsItem]} location={location} onNav={close} />
            )}
            {showAdmin && (
              <NavGroup label="Admin" labelIcon={Settings} items={allAdminItems} location={location} onNav={close} />
            )}
            {showINV && (
              <NavGroup label="Inventario" labelIcon={Package} items={invItems} location={location} onNav={close} checkPrefix />
            )}
            {showShortages && (
              <NavGroup
                label="Faltantes"
                labelIcon={AlertTriangle}
                items={showShortagesManage ? shortageItems : [shortageItems[0]]}
                location={location}
                onNav={close}
                checkPrefix
              />
            )}
            {showHR && (
              <NavGroup
                label="Recursos Humanos"
                labelIcon={Clock}
                items={[...hrSelfItems, ...(showHRManage ? hrManagerItems : [])]}
                location={location}
                onNav={close}
              />
            )}
          </div>

          <div style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600,
              color: "rgba(255,255,255,0.7)", flexShrink: 0,
            }} data-testid="text-user-name">
              {initials}
            </div>
            <span style={{
              flex: 1, fontSize: 13, color: "rgba(255,255,255,0.7)",
              fontFamily: "var(--f-body)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {user?.displayName}
            </span>
            <button
              onClick={() => { close(); logout(); }}
              data-testid="button-logout"
              style={{
                width: 32, height: 32, borderRadius: 6,
                background: "transparent", border: "none",
                color: "rgba(255,255,255,0.4)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
              title="Salir"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
