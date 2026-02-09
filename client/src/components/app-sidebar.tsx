import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
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
  UtensilsCrossed,
  ChefHat,
  CreditCard,
  Settings,
  Users,
  Grid3x3,
  Tag,
  ShoppingBag,
  Wallet,
  LogOut,
} from "lucide-react";

const waiterItems = [
  { title: "Mesas", url: "/tables", icon: Grid3x3 },
];

const kitchenItems = [
  { title: "Cocina (KDS)", url: "/kds", icon: ChefHat },
];

const cashierItems = [
  { title: "POS / Caja", url: "/pos", icon: CreditCard },
];

const managerItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
];

const adminItems = [
  { title: "Mesas", url: "/admin/tables", icon: Grid3x3 },
  { title: "Categorías", url: "/admin/categories", icon: Tag },
  { title: "Productos", url: "/admin/products", icon: ShoppingBag },
  { title: "Métodos de Pago", url: "/admin/payment-methods", icon: Wallet },
  { title: "Usuarios", url: "/admin/users", icon: Users },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const role = user?.role || "";
  const isManager = role === "MANAGER";
  const isWaiter = role === "WAITER" || isManager;
  const isKitchen = role === "KITCHEN" || isManager;
  const isCashier = role === "CASHIER" || isManager;

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
        <div className="p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm">Restaurante</span>
          </div>
        </div>

        {isWaiter && (
          <SidebarGroup>
            <SidebarGroupLabel>Salón</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {waiterItems.map((item) => (
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

        {isKitchen && (
          <SidebarGroup>
            <SidebarGroupLabel>Cocina</SidebarGroupLabel>
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

        {isCashier && (
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

        {isManager && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Gerencia</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {managerItems.map((item) => (
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

            <SidebarGroup>
              <SidebarGroupLabel>
                <Settings className="w-3 h-3 mr-1 inline" />
                Admin
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
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
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 p-2">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">{user?.displayName}</p>
            <p className="text-xs text-muted-foreground" data-testid="text-user-role">{role}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={logout} data-testid="button-logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
