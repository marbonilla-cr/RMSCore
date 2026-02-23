import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

interface PermissionsData {
  permissions: string[];
  role: string;
}

export function usePermissions() {
  const { data, isLoading } = useQuery<PermissionsData>({
    queryKey: ["/api/auth/my-permissions"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  const hasPermission = (key: string): boolean => {
    if (!data) return false;
    return data.permissions.includes(key);
  };

  return {
    permissions: data?.permissions || [],
    role: data?.role || "",
    isLoading,
    hasPermission,
  };
}
