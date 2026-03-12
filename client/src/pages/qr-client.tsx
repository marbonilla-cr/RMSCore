import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, UtensilsCrossed, Coffee, ShoppingCart, User, Check,
  Plus, Minus, ChevronLeft, Pencil, X, Users,
} from "lucide-react";

/* ═══════════════════ Types ═══════════════════ */

interface QRProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryName: string | null;
  categoryFoodType: string;
  categoryParentCode: string | null;
  categorySortOrder: number;
  availablePortions: number | null;
}
interface QRTopCategory { code: string; name: string; }
interface QRMenuResponse { products: QRProduct[]; topCategories: QRTopCategory[]; }
interface ModGroup {
  id: number; name: string; required: boolean; multiSelect: boolean;
  options: { id: number; name: string; priceDelta: string }[];
}
interface Subaccount {
  id: number; orderId: number; tableId: number;
  slotNumber: number; code: string; label: string; isActive: boolean;
}
interface CartItem {
  product: QRProduct;
  qty: number;
  note: string;
  selections: Record<string, number[]>;
  unitPrice: number;
}

/* ═══════════════════ Colors ═══════════════════ */

const C = {
  bg: "#faf8f4", card: "#ffffff", border: "#e8e2d9", border2: "#d4cdc3",
  text: "#1a1612", text2: "#5a524a", text3: "#9a8f83",
  acc: "#2d6a4f", accD: "#e8f5ee", accM: "rgba(45,106,79,0.2)", accT: "rgba(45,106,79,0.06)",
  red: "#c0392b", redD: "#fdecea", overlay: "rgba(15,12,8,0.58)",
};
const serif = "Georgia, serif";
const body = "system-ui, sans-serif";
const mono = "'SF Mono', 'Menlo', monospace";

/* ═══════════════════ CSS ═══════════════════ */

const PAGE_CSS = `
@keyframes qrSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes qrFadeIn{from{opacity:0}to{opacity:1}}
.qr-page *{box-sizing:border-box}
.qr-page{background:${C.bg};min-height:100dvh;font-family:${body};color:${C.text};-webkit-tap-highlight-color:transparent;overflow-x:hidden}
.qr-page input,.qr-page textarea,.qr-page button{font-family:${body}}
`;

/* ═══════════════════ Helpers ═══════════════════ */

function Dots({ cur, total }: { cur: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Array.from({ length: total }, (_, i) => {
        const active = i === cur;
        const done = i < cur;
        return (
          <div key={i} style={{
            width: active ? 20 : 7, height: 7,
            borderRadius: active ? 4 : 50,
            background: active ? C.acc : done ? C.acc : C.border2,
            opacity: done ? 0.35 : 1,
            transition: "all 0.2s ease",
          }} />
        );
      })}
    </div>
  );
}

function Header({ onBack, children, tableCode, dotPos }: {
  onBack: () => void; children?: React.ReactNode; tableCode: string; dotPos: number;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
      borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20,
    }}>
      <button data-testid="button-qr-back" onClick={onBack} style={{
        width: 38, height: 38, borderRadius: 50, border: `1px solid ${C.border}`,
        background: C.card, display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 18, color: C.text2, flexShrink: 0,
      }}>&lsaquo;</button>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <Dots cur={dotPos} total={4} />
      <div style={{
        fontFamily: mono, fontSize: 11, padding: "4px 10px", borderRadius: 20,
        background: C.bg, color: C.text3, textTransform: "uppercase", letterSpacing: "0.06em",
        flexShrink: 0, border: `1px solid ${C.border}`,
      }}>{tableCode}</div>
    </div>
  );
}

function fmtPrice(n: number): string { return formatCurrency(n); }

function FoodIcon({ type, size = 20 }: { type?: string | null; size?: number }) {
  return type === "bebidas"
    ? <Coffee size={size} style={{ color: C.acc }} />
    : <UtensilsCrossed size={size} style={{ color: C.acc }} />;
}

function getModSummary(item: CartItem, groups: ModGroup[] | undefined): string {
  if (!groups) return "";
  const names: string[] = [];
  for (const [gid, oids] of Object.entries(item.selections)) {
    const g = groups.find(x => String(x.id) === gid);
    if (!g) continue;
    for (const oid of oids) {
      const o = g.options.find(x => x.id === oid);
      if (o) names.push(o.name);
    }
  }
  return names.join(" · ");
}

/* ═══════════════════ ProductModal ═══════════════════ */

function ProductModal({ product, existing, onAdd, onClose }: {
  product: QRProduct;
  existing?: CartItem;
  onAdd: (product: QRProduct, qty: number, note: string, selections: Record<string, number[]>, unitPrice: number) => void;
  onClose: () => void;
}) {
  const { data: groups, isLoading } = useQuery<ModGroup[]>({
    queryKey: [`/api/products/${product.id}/modifiers`],
    queryFn: async () => {
      const r = await fetch(`/api/products/${product.id}/modifiers`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const [qty, setQty] = useState(existing?.qty ?? 1);
  const [note, setNote] = useState(existing?.note ?? "");
  const [sel, setSel] = useState<Record<string, number[]>>(existing?.selections ?? {});
  const [tried, setTried] = useState(false);

  const modPrice = useMemo(() => {
    if (!groups) return 0;
    return groups.flatMap(g =>
      g.options.filter(o => sel[g.id]?.includes(o.id)).map(o => Number(o.priceDelta) || 0)
    ).reduce((a, b) => a + b, 0);
  }, [groups, sel]);

  const basePrice = Number(product.price) || 0;
  const unitPrice = basePrice + modPrice;

  const missingRequired = useMemo(() =>
    (groups || []).filter(g => g.required && (!sel[g.id] || sel[g.id].length === 0)),
    [groups, sel]
  );

  function toggle(groupId: number, optionId: number, multi: boolean) {
    setSel(prev => {
      const cur = prev[groupId] ?? [];
      if (multi) {
        return { ...prev, [groupId]: cur.includes(optionId) ? cur.filter(x => x !== optionId) : [...cur, optionId] };
      }
      return { ...prev, [groupId]: cur.includes(optionId) ? [] : [optionId] };
    });
  }

  function handleAdd() {
    setTried(true);
    if (missingRequired.length > 0) return;
    onAdd(product, qty, note, sel, unitPrice);
    onClose();
  }

  const hasGroups = groups && groups.length > 0;

  return (
    <div data-testid="modal-product-overlay" onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100, background: C.overlay,
      display: "flex", flexDirection: "column", justifyContent: "flex-end",
      animation: "qrFadeIn 0.18s ease",
    }}>
      <div data-testid="modal-product-sheet" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: "24px 24px 0 0", maxHeight: "90dvh",
        display: "flex", flexDirection: "column",
        animation: "qrSlideUp 0.22s cubic-bezier(0.32,0.72,0,1)",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border2 }} />
        </div>
        {/* Close btn */}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px 4px" }}>
          <button data-testid="button-modal-close" onClick={onClose} style={{
            width: 34, height: 34, borderRadius: 50, border: `1px solid ${C.border}`,
            background: C.card, cursor: "pointer", fontSize: 18, color: C.text3,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>&times;</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {/* Product header */}
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{
              width: 68, height: 68, borderRadius: 16, background: C.bg,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0,
            }}>
              <FoodIcon type={product.categoryFoodType} size={28} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: serif, fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
                {product.name}
              </div>
              {product.description && (
                <div style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>{product.description}</div>
              )}
              <div style={{ fontSize: 17, fontWeight: 700, color: C.acc, marginTop: 6 }}>
                {fmtPrice(basePrice)}
              </div>
            </div>
          </div>

          {isLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Loader2 className="animate-spin" size={24} style={{ color: C.text3 }} />
            </div>
          )}

          {/* Modifier groups */}
          {hasGroups && (
            <>
              <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />
              {groups!.map(g => (
                <div key={g.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{g.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                      background: g.required ? C.accD : C.bg,
                      color: g.required ? C.acc : C.text3,
                      border: `1px solid ${g.required ? C.accM : C.border}`,
                    }}>
                      {g.required ? "Requerido" : "Opcional"}
                    </span>
                    {g.multiSelect && (
                      <span style={{ fontSize: 10, color: C.text3 }}>(varios)</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {g.options.map(o => {
                      const active = sel[g.id]?.includes(o.id);
                      return (
                        <button key={o.id} data-testid={`button-mod-option-${o.id}`}
                          onClick={() => toggle(g.id, o.id, g.multiSelect)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                            borderRadius: 10, border: `1.5px solid ${active ? C.acc : C.border}`,
                            background: active ? C.accT : C.card, cursor: "pointer",
                            textAlign: "left", width: "100%", minHeight: 44,
                            transition: "all 0.15s ease",
                          }}>
                          {/* Radio / Checkbox indicator */}
                          <div style={{
                            width: 20, height: 20, borderRadius: g.multiSelect ? 6 : 50,
                            border: `2px solid ${active ? C.acc : C.border2}`,
                            background: active ? C.acc : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0, transition: "all 0.15s ease",
                          }}>
                            {active && <Check size={12} style={{ color: "#fff" }} />}
                          </div>
                          <span style={{ flex: 1, fontSize: 14, color: C.text }}>{o.name}</span>
                          {Number(o.priceDelta) > 0 && (
                            <span style={{ fontSize: 13, color: C.acc, fontWeight: 600 }}>
                              +{fmtPrice(Number(o.priceDelta))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {tried && g.required && (!sel[g.id] || sel[g.id].length === 0) && (
                    <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>
                      Seleccione al menos una opci&oacute;n
                    </div>
                  )}
                </div>
              ))}
              <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "8px 0 16px" }} />
            </>
          )}

          {/* Quantity */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Cantidad</span>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button data-testid="button-modal-qty-minus" onClick={() => setQty(q => Math.max(1, q - 1))} style={{
                width: 38, height: 38, borderRadius: 50, border: `1.5px solid ${C.border}`,
                background: C.card, cursor: "pointer", fontSize: 20, color: C.text2,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>&minus;</button>
              <span style={{ fontSize: 20, fontWeight: 700, minWidth: 24, textAlign: "center" }}>{qty}</span>
              <button data-testid="button-modal-qty-plus" onClick={() => setQty(q => q + 1)} style={{
                width: 38, height: 38, borderRadius: 50, border: `1.5px solid ${C.acc}`,
                background: C.accD, cursor: "pointer", fontSize: 20, color: C.acc,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>+</button>
            </div>
          </div>

          {/* Note */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 13, color: C.text2, marginBottom: 6, display: "block" }}>
              <Pencil size={12} style={{ marginRight: 4, display: "inline" }} /> Nota para cocina (opcional)
            </label>
            <textarea data-testid="input-modal-note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Ej: sin cebolla, extra picante..."
              rows={2} style={{
                width: "100%", padding: 12, borderRadius: 10, border: `1.5px solid ${C.border}`,
                background: C.bg, fontSize: 14, color: C.text, resize: "none",
                fontFamily: body,
              }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 20px", borderTop: `1px solid ${C.border}`, background: C.card,
        }}>
          {tried && missingRequired.length > 0 && (
            <div style={{
              fontSize: 13, color: C.red, background: C.redD, padding: "8px 12px",
              borderRadius: 8, marginBottom: 10, textAlign: "center",
            }}>
              Seleccione las opciones requeridas
            </div>
          )}
          <button data-testid="button-modal-add" onClick={handleAdd} style={{
            width: "100%", padding: "14px 20px", borderRadius: 14, border: "none",
            background: C.acc, color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            minHeight: 48,
          }}>
            {existing ? <><Pencil size={14} /> Actualizar</> : <><ShoppingCart size={14} /> Pedir</>} &middot; {fmtPrice(unitPrice * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Main Component ═══════════════════ */

export default function QRClientPage() {
  const [, params] = useRoute("/qr/:tableCode");
  const tableCode = params?.tableCode || "";
  const { toast } = useToast();

  const [screen, setScreen] = useState<"gc" | 0 | 1 | 2 | 3 | 4>("gc");
  const [gcInput, setGcInput] = useState("");
  const [name, setName] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tab, setTab] = useState<string>("");
  const [popup, setPopup] = useState<QRProduct | null>(null);
  const [sending, setSending] = useState(false);
  const [subaccountId, setSubaccountId] = useState<number | null>(null);
  const [qrToken, setQrToken] = useState<string>("");

  /* ─── Fetch daily QR token ─── */
  useEffect(() => {
    if (!tableCode) return;
    fetch(`/api/qr/${tableCode}/token`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token) setQrToken(data.token); })
      .catch(() => {});
  }, [tableCode]);

  /* ─── Data fetching ─── */

  const { data: info, isLoading: infoLoading } = useQuery<{ tableName: string; maxSubaccounts: number; hasGuestCount: boolean; orderId: number | null }>({
    queryKey: ["/api/qr", tableCode, "info"],
    queryFn: async () => {
      const r = await fetch(`/api/qr/${tableCode}/info`);
      if (!r.ok) throw new Error("Mesa no encontrada");
      return r.json();
    },
    enabled: !!tableCode,
  });

  useEffect(() => {
    if (info && screen === "gc" && info.hasGuestCount) {
      setScreen(0);
    }
  }, [info, screen]);

  const { data: menuData, isLoading: menuLoading } = useQuery<QRMenuResponse>({
    queryKey: ["/api/qr", tableCode, "menu"],
    queryFn: async () => {
      const r = await fetch(`/api/qr/${tableCode}/menu`);
      if (!r.ok) throw new Error("Error cargando menú");
      return r.json();
    },
    enabled: !!tableCode && typeof screen === "number" && screen >= 2,
  });

  const menu = menuData?.products || [];
  const topCats = menuData?.topCategories || [];

  const { data: subaccounts = [] } = useQuery<Subaccount[]>({
    queryKey: ["/api/qr", tableCode, "subaccounts", qrToken],
    queryFn: async () => {
      const r = await fetch(`/api/qr/${tableCode}/subaccounts`, {
        headers: qrToken ? { "x-qr-token": qrToken } : {},
      });
      if (r.status === 403) {
        const fresh = await fetch(`/api/qr/${tableCode}/token`).then(r2 => r2.ok ? r2.json() : null);
        if (fresh?.token) { setQrToken(fresh.token); }
        return [];
      }
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!tableCode && screen === 1 && !!qrToken,
  });

  const existingNames = useMemo(() => {
    const labels = subaccounts.filter(s => s.label).map(s => s.label);
    return Array.from(new Set(labels));
  }, [subaccounts]);

  /* ─── Set default tab ─── */

  useEffect(() => {
    if (topCats.length > 0 && !tab) {
      setTab(topCats[0].code);
    }
  }, [topCats]);

  /* ─── Filtered products ─── */

  const categoryGroups = useMemo(() => {
    let prods = menu;
    if (topCats.length > 0 && tab) {
      prods = menu.filter(p => p.categoryParentCode === tab);
    }
    const groups = new Map<string, QRProduct[]>();
    prods.forEach(p => {
      const cat = p.categoryName || "Otros";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    });
    return Array.from(groups.entries())
      .map(([catName, products]) => ({ catName, products, sortOrder: products[0]?.categorySortOrder ?? 9999 }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [menu, tab, topCats]);

  /* ─── Cart helpers ─── */

  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.qty, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const cartItemForProduct = useCallback((pid: number) => cart.find(c => c.product.id === pid), [cart]);

  function handleAddToCart(product: QRProduct, qty: number, note: string, selections: Record<string, number[]>, unitPrice: number) {
    setCart(prev => {
      const idx = prev.findIndex(c => c.product.id === product.id);
      const item: CartItem = { product, qty, note, selections, unitPrice };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  }

  function updateQty(pid: number, delta: number) {
    setCart(prev => {
      const next = prev.map(c =>
        c.product.id === pid ? { ...c, qty: c.qty + delta } : c
      ).filter(c => c.qty > 0);
      return next;
    });
  }

  /* ─── Submit ─── */

  async function handleSubmit() {
    if (cart.length === 0 || sending) return;
    setSending(true);
    try {
      let sid = subaccountId;
      if (!sid) {
        const subRes = await fetch(`/api/qr/${tableCode}/subaccounts`, {
          method: "POST", headers: { "Content-Type": "application/json", ...(qrToken ? { "x-qr-token": qrToken } : {}) },
          body: JSON.stringify({ label: name }),
        });
        if (subRes.status === 403) {
          const fresh = await fetch(`/api/qr/${tableCode}/token`).then(r2 => r2.ok ? r2.json() : null);
          if (fresh?.token) setQrToken(fresh.token);
          throw new Error("Token expirado. Intente de nuevo.");
        }
        if (subRes.status === 409) {
          setScreen(1);
          throw new Error("Ese nombre ya está en uso en esta mesa. Por favor usá un nombre diferente.");
        }
        if (!subRes.ok) {
          const d = await subRes.json().catch(() => ({ message: "Error" }));
          throw new Error(d.message);
        }
        const sub = await subRes.json();
        sid = sub.id;
        setSubaccountId(sid);
      }

      const items = cart.map(c => ({
        productId: c.product.id,
        productName: c.product.name,
        unitPrice: String(c.unitPrice),
        qty: c.qty,
        customerName: name,
        modifiers: Object.entries(c.selections).flatMap(([gid, oids]) =>
          oids.map(oid => ({ modGroupId: Number(gid), optionId: oid }))
        ),
        notes: c.note || undefined,
      }));

      const res = await fetch(`/api/qr/${tableCode}/submit-v2`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(qrToken ? { "x-qr-token": qrToken } : {}) },
        body: JSON.stringify({ subaccountId: sid, items }),
      });

      if (res.status === 403) {
        const fresh = await fetch(`/api/qr/${tableCode}/token`).then(r2 => r2.ok ? r2.json() : null);
        if (fresh?.token) setQrToken(fresh.token);
        throw new Error("Token expirado. Intente de nuevo.");
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({ message: "Error" }));
        throw new Error(d.message);
      }

      setScreen(4);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  /* ─── Fetch modifiers for summary text ─── */
  const [modGroupsCache, setModGroupsCache] = useState<Record<number, ModGroup[]>>({});

  useEffect(() => {
    cart.forEach(c => {
      if (Object.keys(c.selections).length > 0 && !modGroupsCache[c.product.id]) {
        fetch(`/api/products/${c.product.id}/modifiers`)
          .then(r => r.ok ? r.json() : [])
          .then(groups => setModGroupsCache(prev => ({ ...prev, [c.product.id]: groups })));
      }
    });
  }, [cart]);

  /* ═══════════════════ Render ═══════════════════ */

  if (infoLoading) {
    return (
      <div className="qr-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <style>{PAGE_CSS}</style>
        <Loader2 className="animate-spin" size={32} style={{ color: C.text3 }} />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="qr-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", padding: 32, textAlign: "center" }}>
        <style>{PAGE_CSS}</style>
        <div>
          <div style={{ marginBottom: 16 }}><X size={40} style={{ color: C.text3 }} /></div>
          <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Mesa no encontrada</div>
          <div style={{ fontSize: 14, color: C.text3 }}>Verific&aacute; que el c&oacute;digo QR sea correcto.</div>
        </div>
      </div>
    );
  }

  const tableName = info.tableName || tableCode;

  /* ── SGC: Guest Count ── */
  if (screen === "gc") {
    const gcValid = gcInput.trim() !== "" && Number(gcInput) >= 1;
    const handleGuestCount = async () => {
      const count = parseInt(gcInput);
      if (isNaN(count) || count < 1) return;
      try {
        const r = await fetch(`/api/qr/${tableCode}/guest-count`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestCount: count }),
        });
        if (!r.ok) throw new Error("Error");
        setScreen(0);
      } catch {
        toast({ title: "Error", description: "No se pudo guardar. Intentá de nuevo.", variant: "destructive" });
      }
    };
    return (
      <div className="qr-page" style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "100dvh", padding: "32px 24px", textAlign: "center",
      }}>
        <style>{PAGE_CSS}</style>
        <div style={{
          width: 88, height: 88, borderRadius: 24, background: C.accD,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 20,
        }}><Users size={40} style={{ color: C.acc }} /></div>
        <div style={{
          fontFamily: mono, fontSize: 11, padding: "4px 12px", borderRadius: 20,
          background: C.bg, color: C.text3, textTransform: "uppercase",
          letterSpacing: "0.08em", border: `1px solid ${C.border}`, marginBottom: 16,
        }}>{tableName}</div>
        <div style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          &iquest;Cu&aacute;ntos son en tu grupo?
        </div>
        <div style={{ fontSize: 15, color: C.text2, maxWidth: 320, lineHeight: 1.5, marginBottom: 28 }}>
          Digit&aacute; la cantidad de personas
        </div>
        <input
          data-testid="input-gc"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min="1"
          autoFocus
          value={gcInput}
          onChange={e => {
            const v = e.target.value.replace(/[^0-9]/g, "");
            setGcInput(v);
          }}
          onKeyDown={e => { if (e.key === "Enter" && gcValid) handleGuestCount(); }}
          placeholder="Ej: 4"
          style={{
            width: "100%", maxWidth: 200, padding: "16px 20px", borderRadius: 14,
            border: `1.5px solid ${gcValid ? C.acc : C.border}`, background: C.card,
            fontSize: 32, fontWeight: 700, color: C.text, textAlign: "center",
            outline: "none", transition: "border-color 0.2s",
            fontFamily: body,
          }}
        />
        <button
          data-testid="button-gc-confirm"
          disabled={!gcValid}
          onClick={handleGuestCount}
          style={{
            marginTop: 20, padding: "14px 48px", borderRadius: 30, border: "none",
            background: gcValid ? C.acc : C.border, color: gcValid ? "#fff" : C.text3,
            fontSize: 16, fontWeight: 700, cursor: gcValid ? "pointer" : "default",
            minHeight: 48, transition: "all 0.2s",
          }}
        >
          Continuar
        </button>
      </div>
    );
  }

  /* ── S0: Welcome ── */
  if (screen === 0) {
    return (
      <div className="qr-page" style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "100dvh", padding: "32px 24px", textAlign: "center",
      }}>
        <style>{PAGE_CSS}</style>
        <div style={{
          width: 88, height: 88, borderRadius: 24, background: C.accD,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 40, marginBottom: 20,
        }}><UtensilsCrossed size={40} style={{ color: C.acc }} /></div>
        <div style={{
          fontFamily: mono, fontSize: 11, padding: "4px 12px", borderRadius: 20,
          background: C.bg, color: C.text3, textTransform: "uppercase",
          letterSpacing: "0.08em", border: `1px solid ${C.border}`, marginBottom: 16,
        }}>{tableName}</div>
        <div style={{ fontFamily: serif, fontSize: 32, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          Bienvenido
        </div>
        <div style={{ fontSize: 16, color: C.text2, maxWidth: 320, lineHeight: 1.5, marginBottom: 32 }}>
          Ped&iacute; lo que quer&aacute;s. Un salonero confirma antes de enviarlo a cocina.
        </div>
        <button data-testid="button-qr-start" onClick={() => setScreen(1)} style={{
          padding: "16px 40px", borderRadius: 30, border: "none", background: C.acc,
          color: "#fff", fontSize: 17, fontWeight: 700, cursor: "pointer", minHeight: 48,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <ShoppingCart size={18} /> Empezar a pedir
        </button>
        <div style={{ fontSize: 13, color: C.text3, marginTop: 14 }}>
          Toc&aacute; el bot&oacute;n para comenzar
        </div>
      </div>
    );
  }

  /* ── S1: Name ── */
  if (screen === 1) {
    return (
      <div className="qr-page" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <style>{PAGE_CSS}</style>
        <Header onBack={() => setScreen(0)} tableCode={tableName} dotPos={0}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Tu nombre</div>
        </Header>
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "32px 24px", textAlign: "center",
        }}>
          <div style={{
            width: 68, height: 68, borderRadius: 50, background: C.accD,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 30, marginBottom: 20,
          }}><User size={30} style={{ color: C.acc }} /></div>
          <div style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            &iquest;C&oacute;mo te llam&aacute;s?
          </div>
          <div style={{ fontSize: 14, color: C.text2, marginBottom: 24 }}>
            Para que el salonero sepa qui&eacute;n pidi&oacute; qu&eacute;.
          </div>
          <input
            data-testid="input-qr-name"
            value={name}
            onChange={e => {
              setName(e.target.value);
              setSubaccountId(null);
            }}
            placeholder="Tu nombre"
            autoFocus
            style={{
              width: "100%", maxWidth: 320, padding: 18, fontSize: 22, textAlign: "center",
              borderRadius: 14, border: `2px solid ${name.trim() ? (existingNames.some(n => n.trim().toLowerCase() === name.trim().toLowerCase()) && !subaccountId ? "#d32f2f" : C.acc) : C.border}`,
              background: C.card, color: C.text, outline: "none",
              transition: "border-color 0.2s ease",
            }}
          />
          {name.trim() && existingNames.some(n => n.trim().toLowerCase() === name.trim().toLowerCase()) && !subaccountId ? (
            <div style={{ fontSize: 13, color: "#d32f2f", marginTop: 10, fontWeight: 500 }}>
              Ese nombre ya est&aacute; en uso. Escog&eacute;lo de la lista o us&aacute; un nombre diferente.
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.text3, marginTop: 10 }}>
              Escrib&iacute; tu nombre o escog&eacute; uno
            </div>
          )}

          {existingNames.length > 0 && (
            <div style={{ marginTop: 20, width: "100%", maxWidth: 320 }}>
              <div style={{ fontSize: 16, color: "#e07b00", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                Ya en la mesa
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {existingNames.map(n => (
                  <button key={n} data-testid={`button-qr-name-${n}`} onClick={() => {
                    setName(n);
                    const match = subaccounts.find(s => s.label === n);
                    if (match) setSubaccountId(match.id);
                  }} style={{
                    padding: "8px 18px", borderRadius: 20, border: `2.5px solid ${name === n ? "#c8660a" : "#e07b00"}`,
                    background: name === n ? "#e07b00" : "rgba(224,123,0,0.08)", color: name === n ? "#fff" : "#c8660a",
                    fontSize: 16, fontWeight: 600, cursor: "pointer", minHeight: 38,
                    transition: "all 0.15s ease",
                  }}>{n}</button>
                ))}
              </div>
            </div>
          )}

          <button
            data-testid="button-qr-continue-name"
            onClick={() => { if (name.trim()) setScreen(2); }}
            disabled={!name.trim() || (existingNames.some(n => n.trim().toLowerCase() === name.trim().toLowerCase()) && !subaccountId)}
            style={{
              marginTop: 32, padding: "14px 40px", borderRadius: 30, border: "none",
              background: C.acc, color: "#fff", fontSize: 16, fontWeight: 700,
              cursor: name.trim() && !(existingNames.some(n => n.trim().toLowerCase() === name.trim().toLowerCase()) && !subaccountId) ? "pointer" : "default",
              opacity: name.trim() && !(existingNames.some(n => n.trim().toLowerCase() === name.trim().toLowerCase()) && !subaccountId) ? 1 : 0.4, minHeight: 48,
              transition: "opacity 0.2s ease",
            }}
          >
            Continuar &rarr;
          </button>
        </div>
      </div>
    );
  }

  /* ── S2: Menu ── */
  if (screen === 2) {
    return (
      <div className="qr-page" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <style>{PAGE_CSS}</style>
        <Header onBack={() => setScreen(1)} tableCode={tableName} dotPos={1}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Hola, {name}</div>
          <div style={{ fontSize: 12, color: C.text3 }}>Toc&aacute; un plato para agregarlo</div>
        </Header>

        {/* Category tabs */}
        {topCats.length > 0 && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 16px", overflowX: "auto",
            borderBottom: `1px solid ${C.border}`, background: C.card,
            WebkitOverflowScrolling: "touch",
          }}>
            {topCats.map(tc => (
              <button key={tc.code} data-testid={`button-qr-tab-${tc.code}`}
                onClick={() => setTab(tc.code)}
                style={{
                  padding: "8px 18px", borderRadius: 20, border: "none", whiteSpace: "nowrap",
                  background: tab === tc.code ? C.acc : C.bg,
                  color: tab === tc.code ? "#fff" : C.text2,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 36,
                  transition: "all 0.15s ease", flexShrink: 0,
                }}>{tc.name}</button>
            ))}
          </div>
        )}

        {/* Product list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", paddingBottom: cartCount > 0 ? 80 : 14 }}>
          {menuLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 className="animate-spin" size={28} style={{ color: C.text3 }} />
            </div>
          ) : categoryGroups.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: C.text3 }}>
              No hay productos disponibles
            </div>
          ) : (
            categoryGroups.map(({ catName, products }) => (
              <div key={catName} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: C.text3, textTransform: "uppercase",
                  letterSpacing: "0.05em", marginBottom: 8, paddingLeft: 2,
                }}>{catName}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {products.map(p => {
                    const inCart = cartItemForProduct(p.id);
                    const modSummary = inCart ? getModSummary(inCart, modGroupsCache[p.id]) : "";
                    return (
                      <button key={p.id} data-testid={`button-qr-product-${p.id}`}
                        onClick={() => setPopup(p)}
                        style={{
                          display: "flex", alignItems: "center", gap: 12, padding: 14,
                          borderRadius: 14, border: `1.5px solid ${inCart ? C.acc : C.border}`,
                          background: inCart ? C.accT : C.card, cursor: "pointer",
                          textAlign: "left", width: "100%",
                          transition: "all 0.15s ease",
                        }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: 12, background: C.bg,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 24, flexShrink: 0,
                        }}>
                          <FoodIcon type={p.categoryFoodType} size={22} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.name}</span>
                          </div>
                          {p.description && (
                            <div style={{
                              fontSize: 12, color: C.text3, marginTop: 2,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{p.description}</div>
                          )}
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.acc, marginTop: 4 }}>
                            {inCart ? fmtPrice(inCart.unitPrice) : fmtPrice(Number(p.price))}
                          </div>
                          {inCart && modSummary && (
                            <div style={{ fontSize: 11, color: C.acc, marginTop: 2 }}>
                              &bull; {modSummary}
                            </div>
                          )}
                          {inCart && inCart.note && (
                            <div style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>
                              <Pencil size={10} style={{ display: "inline", marginRight: 3 }} />{inCart.note}
                            </div>
                          )}
                        </div>
                        <div style={{
                          width: 34, height: 34, borderRadius: 50, flexShrink: 0,
                          background: inCart ? C.acc : C.accD,
                          color: inCart ? "#fff" : C.acc,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: inCart ? 14 : 18, fontWeight: 700,
                        }}>
                          {inCart ? inCart.qty : "+"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sticky cart footer */}
        {cartCount > 0 && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
            padding: "10px 14px 14px",
          }}>
            <button data-testid="button-qr-view-cart" onClick={() => setScreen(3)} style={{
              width: "100%", padding: "14px 20px", borderRadius: 16, border: "none",
              background: C.acc, color: "#fff", fontSize: 15, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
              minHeight: 48, boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><ShoppingCart size={16} /> {cartCount} {cartCount === 1 ? "item" : "items"}</span>
              <span>Ver mi pedido</span>
              <span style={{ fontFamily: mono }}>{fmtPrice(cartTotal)}</span>
            </button>
          </div>
        )}

        {/* Product modal */}
        {popup && (
          <ProductModal
            product={popup}
            existing={cartItemForProduct(popup.id)}
            onAdd={handleAddToCart}
            onClose={() => setPopup(null)}
          />
        )}
      </div>
    );
  }

  /* ── S3: Review ── */
  if (screen === 3) {
    return (
      <div className="qr-page" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <style>{PAGE_CSS}</style>
        <Header onBack={() => setScreen(2)} tableCode={tableName} dotPos={2}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Tu pedido</div>
          <div style={{ fontSize: 12, color: C.text3 }}>{cartCount} {cartCount === 1 ? "producto" : "productos"}</div>
        </Header>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px" }}>
          {/* Info card */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16,
            padding: 14, borderRadius: 12, background: C.bg, border: `1px solid ${C.border}`,
          }}>
            <div>
              <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mesa</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 2 }}>{tableName}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Nombre</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 2 }}>{name}</div>
            </div>
          </div>

          {/* Cart items */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cart.map(item => {
              const modSummary = getModSummary(item, modGroupsCache[item.product.id]);
              return (
                <div key={item.product.id} style={{
                  display: "flex", gap: 12, padding: 14, borderRadius: 12,
                  background: C.card, border: `1px solid ${C.border}`,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, background: C.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, flexShrink: 0,
                  }}>
                    <FoodIcon type={item.product.categoryFoodType} size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{item.product.name}</div>
                    {modSummary && (
                      <div style={{ fontSize: 12, color: C.acc, marginTop: 2 }}>&bull; {modSummary}</div>
                    )}
                    {item.note && (
                      <div style={{ fontSize: 12, color: C.text3, marginTop: 1, display: "flex", alignItems: "center", gap: 3 }}><Pencil size={10} />{item.note}</div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: C.text2 }}>{fmtPrice(item.unitPrice)} c/u</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.acc }}>{fmtPrice(item.unitPrice * item.qty)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <button data-testid={`button-qr-qty-minus-${item.product.id}`}
                      onClick={() => {
                        updateQty(item.product.id, -1);
                        if (item.qty <= 1 && cart.length <= 1) setScreen(2);
                      }}
                      style={{
                        width: 34, height: 34, borderRadius: 50, border: `1.5px solid ${C.border}`,
                        background: C.card, cursor: "pointer", fontSize: 18, color: C.text2,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>&minus;</button>
                    <span style={{ fontSize: 17, fontWeight: 700, minWidth: 20, textAlign: "center" }}>{item.qty}</span>
                    <button data-testid={`button-qr-qty-plus-${item.product.id}`}
                      onClick={() => updateQty(item.product.id, 1)}
                      style={{
                        width: 34, height: 34, borderRadius: 50, border: `1.5px solid ${C.acc}`,
                        background: C.accD, cursor: "pointer", fontSize: 18, color: C.acc,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 16, padding: "14px 16px", borderRadius: 12,
            background: C.accD, border: `1.5px solid ${C.accM}`,
          }}>
            <span style={{ fontFamily: serif, fontSize: 20, fontWeight: 700, color: C.text }}>Total</span>
            <span style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.acc }}>{fmtPrice(cartTotal)}</span>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <button data-testid="button-qr-add-more" onClick={() => setScreen(2)} style={{
              width: "100%", padding: "12px 20px", borderRadius: 14,
              border: `1.5px solid ${C.border}`, background: C.card,
              color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 48,
            }}>
              + Agregar algo m&aacute;s
            </button>
            <button data-testid="button-qr-confirm" onClick={handleSubmit}
              disabled={sending || cart.length === 0}
              style={{
                width: "100%", padding: "14px 20px", borderRadius: 14, border: "none",
                background: C.acc, color: "#fff", fontSize: 16, fontWeight: 700,
                cursor: sending ? "wait" : "pointer", minHeight: 48,
                opacity: sending ? 0.7 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {sending ? (
                <><Loader2 className="animate-spin" size={18} /> Enviando...</>
              ) : (
                <><Check size={16} /> Confirmar y enviar</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── S4: Sent ── */
  if (screen === 4) {
    return (
      <div className="qr-page" style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        minHeight: "100dvh", padding: "48px 24px", textAlign: "center",
      }}>
        <style>{PAGE_CSS}</style>
        <div style={{
          width: 96, height: 96, borderRadius: 50, background: C.accD,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 44, marginBottom: 20,
        }}><Check size={44} style={{ color: C.acc }} /></div>
        <div style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          &iexcl;Pedido enviado!
        </div>
        <div style={{ fontSize: 15, color: C.text2, maxWidth: 300, lineHeight: 1.5, marginBottom: 28 }}>
          Un salonero va a confirmar tu pedido en un momento.
        </div>

        {/* Order summary */}
        <div style={{
          width: "100%", maxWidth: 400, borderRadius: 14, border: `1px solid ${C.border}`,
          background: C.card, overflow: "hidden", textAlign: "left",
        }}>
          {cart.map((item, i) => {
            const modSummary = getModSummary(item, modGroupsCache[item.product.id]);
            return (
              <div key={i} style={{
                display: "flex", gap: 10, padding: "12px 16px",
                borderBottom: i < cart.length - 1 ? `1px solid ${C.border}` : "none",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: C.bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, flexShrink: 0,
                }}>
                  <FoodIcon type={item.product.categoryFoodType} size={16} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                    {item.product.name} <span style={{ color: C.text3, fontWeight: 400 }}>&times;{item.qty}</span>
                  </div>
                  {modSummary && <div style={{ fontSize: 11, color: C.acc, marginTop: 1 }}>&bull; {modSummary}</div>}
                  {item.note && <div style={{ fontSize: 11, color: C.text3, marginTop: 1, display: "flex", alignItems: "center", gap: 3 }}><Pencil size={10} />{item.note}</div>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, flexShrink: 0 }}>
                  {fmtPrice(item.unitPrice * item.qty)}
                </div>
              </div>
            );
          })}
          <div style={{
            display: "flex", justifyContent: "space-between", padding: "12px 16px",
            background: C.accD, borderTop: `1px solid ${C.accM}`,
          }}>
            <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.text }}>Total</span>
            <span style={{ fontFamily: serif, fontSize: 18, fontWeight: 700, color: C.acc }}>{fmtPrice(cartTotal)}</span>
          </div>
        </div>

        <button data-testid="button-qr-order-more" onClick={() => {
          setCart([]);
          setSubaccountId(null);
          setName("");
          setScreen(1);
        }} style={{
          marginTop: 24, padding: "14px 32px", borderRadius: 30, border: `1.5px solid ${C.acc}`,
          background: C.card, color: C.acc, fontSize: 15, fontWeight: 600,
          cursor: "pointer", minHeight: 48,
        }}>
          + Pedir algo m&aacute;s
        </button>
      </div>
    );
  }

  return null;
}
