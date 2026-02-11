import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, Save } from "lucide-react";

interface Permission {
  id: number;
  key: string;
  description: string;
}

type RolePermissions = Record<string, string[]>;

const ROLES = ["MANAGER", "CASHIER", "WAITER", "KITCHEN", "STAFF"];
const ROLE_LABELS: Record<string, string> = {
  MANAGER: "Gerente",
  CASHIER: "Cajero",
  WAITER: "Salonero",
  KITCHEN: "Cocina",
  STAFF: "Personal",
};

export default function AdminRolesPage() {
  const { toast } = useToast();
  const [localPermissions, setLocalPermissions] = useState<RolePermissions>({});
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());

  const { data: permissions = [], isLoading: permLoading } = useQuery<Permission[]>({
    queryKey: ["/api/admin/permissions"],
  });

  const { data: rolePermissions, isLoading: rpLoading } = useQuery<RolePermissions>({
    queryKey: ["/api/admin/role-permissions"],
  });

  useEffect(() => {
    if (rolePermissions) {
      setLocalPermissions(rolePermissions);
      setDirtyRoles(new Set());
    }
  }, [rolePermissions]);

  const saveMutation = useMutation({
    mutationFn: async (role: string) => {
      return apiRequest("PUT", `/api/admin/role-permissions/${role}`, {
        permissions: localPermissions[role] || [],
      });
    },
    onSuccess: (_data, role) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-permissions"] });
      setDirtyRoles((prev) => {
        const next = new Set(prev);
        next.delete(role);
        return next;
      });
      toast({ title: `Permisos de ${ROLE_LABELS[role] || role} guardados` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const togglePermission = (role: string, permKey: string) => {
    setLocalPermissions((prev) => {
      const current = prev[role] || [];
      const has = current.includes(permKey);
      return {
        ...prev,
        [role]: has ? current.filter((k) => k !== permKey) : [...current, permKey],
      };
    });
    setDirtyRoles((prev) => new Set(prev).add(role));
  };

  const isLoading = permLoading || rpLoading;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Shield className="w-6 h-6" />
            Roles y Permisos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configure los permisos para cada rol del sistema</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : permissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay permisos configurados</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Permiso</TableHead>
                    {ROLES.map((role) => (
                      <TableHead key={role} className="text-center min-w-[100px]">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="secondary" data-testid={`badge-role-${role}`}>
                            {ROLE_LABELS[role]}
                          </Badge>
                          {dirtyRoles.has(role) && (
                            <Button
                              size="sm"
                              onClick={() => saveMutation.mutate(role)}
                              disabled={saveMutation.isPending}
                              data-testid={`button-save-role-${role}`}
                            >
                              {saveMutation.isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              <span className="ml-1">Guardar</span>
                            </Button>
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map((perm) => (
                    <TableRow key={perm.id} data-testid={`row-permission-${perm.key}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm" data-testid={`text-permission-key-${perm.key}`}>
                            {perm.key}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-permission-desc-${perm.key}`}>
                            {perm.description}
                          </p>
                        </div>
                      </TableCell>
                      {ROLES.map((role) => {
                        const checked = (localPermissions[role] || []).includes(perm.key);
                        return (
                          <TableCell key={role} className="text-center">
                            <div className="flex justify-center">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => togglePermission(role, perm.key)}
                                data-testid={`checkbox-perm-${role}-${perm.key}`}
                              />
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}