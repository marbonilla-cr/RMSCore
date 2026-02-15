import { useEffect, useRef } from "react";
import { wsManager } from "@/lib/ws";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "triangle";
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

export function useShortageAlerts() {
  const { toast } = useToast();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    wsManager.connect();

    const unsubCreated = wsManager.on("shortage_created", (payload: any) => {
      if (!mounted.current) return;
      queryClient.invalidateQueries({ queryKey: ["/api/shortages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shortages/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shortages/active-count"] });
      playAlertBeep();
      toast({
        title: "Nuevo faltante reportado",
        description: payload?.shortage?.entityType === "INV_ITEM" ? "Se reporto un insumo faltante" : "Se reporto un producto faltante",
        variant: "destructive",
      });
    });

    const unsubUpdated = wsManager.on("shortage_updated", () => {
      if (!mounted.current) return;
      queryClient.invalidateQueries({ queryKey: ["/api/shortages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shortages/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shortages/active-count"] });
    });

    const unsubAvail = wsManager.on("product_availability_changed", () => {
      if (!mounted.current) return;
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    });

    return () => {
      mounted.current = false;
      unsubCreated();
      unsubUpdated();
      unsubAvail();
    };
  }, [toast]);
}
