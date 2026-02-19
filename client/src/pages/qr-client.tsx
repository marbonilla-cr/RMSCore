import { useState, useCallback, useMemo, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  UtensilsCrossed, Plus, Loader2, Check, ChevronLeft, ChevronRight,
  X, Users, User, ArrowRight, Coffee, ChefHat,
  Utensils, Send, CheckCircle2, ShoppingBag, ChevronDown, BookOpen,
} from "lucide-react";

type Step = "welcome" | "subaccount" | "name" | "mode_select" | "easy_cats" | "easy_products" | "easy_review" | "menu" | "modifiers" | "review" | "view_menu" | "sent";

type Mode = "easy" | "standard" | "view_menu" | null;

interface QRProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryName: string | null;
  categoryFoodType: string;
  categoryParentCode: string | null;
  availablePortions: number | null;
}

interface QRTopCategory {
  code: string;
  name: string;
}

interface QRMenuResponse {
  products: QRProduct[];
  topCategories: QRTopCategory[];
}

interface QRModifierGroup {
  id: number;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: { id: number; name: string; priceDelta: string }[];
}

interface Subaccount {
  id: number;
  orderId: number;
  tableId: number;
  slotNumber: number;
  code: string;
  label: string;
  isActive: boolean;
}

interface CartItem {
  productId: number;
  productName: string;
  unitPrice: string;
  qty: number;
  customerName: string;
  modifiers?: { modGroupId: number; optionId: number }[];
  categoryName: string;
}

const MAX_SUBACCOUNTS = 6;

const QR_STYLES = `
.qr-page {
  --qr-bg: #0d1117;
  --qr-s1: #161d26;
  --qr-s2: #1c2535;
  --qr-accent: #22c55e;
  --qr-text: #e8edf3;
  --qr-sub: #6b7fa0;
  --qr-red: #ef4444;
  background: var(--qr-bg);
  min-height: 100dvh;
  font-family: var(--f-body);
  color: var(--qr-text);
  display: flex;
  flex-direction: column;
}
.qr-header {
  position: sticky; top: 0; z-index: 9999;
  padding: 16px 20px;
  background: var(--qr-bg);
  display: flex; align-items: center; gap: 12px;
}
.qr-back {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--qr-s2); border: none;
  color: var(--qr-text); font-size: 22px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.qr-back:active { background: var(--qr-s1); }
.qr-progress { display: flex; gap: 6px; flex: 1; justify-content: center; }
.qr-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--qr-s2); transition: all 0.3s ease;
}
.qr-dot.done { background: var(--qr-accent); }
.qr-table-chip {
  background: var(--qr-s2); padding: 5px 12px; border-radius: 20px;
  font-family: var(--f-mono); font-size: 11px; color: var(--qr-sub);
}
.qr-content { padding: 0 20px; flex: 1; }
.qr-footer {
  position: sticky; bottom: 0; z-index: 9999;
  padding: 16px 20px;
  background: linear-gradient(to top, var(--qr-bg) 80%, transparent);
}
.qr-cta {
  width: 100%; padding: 16px; border-radius: var(--r-md);
  background: var(--qr-accent); color: #050f08;
  font-family: var(--f-disp); font-size: 18px; font-weight: 800;
  letter-spacing: 0.04em; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  transition: transform 0.1s;
}
.qr-cta:disabled { background: var(--qr-s2); color: var(--qr-sub); cursor: not-allowed; }
.qr-cta:active:not(:disabled) { transform: scale(0.98); }
.qr-cta-outline {
  width: 100%; padding: 16px; border-radius: var(--r-md);
  background: transparent; color: var(--qr-text);
  font-family: var(--f-disp); font-size: 18px; font-weight: 800;
  letter-spacing: 0.04em; border: 1.5px solid var(--qr-s2); cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  transition: all 0.15s;
}
.qr-cta-outline:active { background: var(--qr-s2); transform: scale(0.98); }
.qr-step-title {
  font-family: var(--f-disp); font-size: 26px; font-weight: 800; margin-bottom: 6px;
}
.qr-step-sub { color: var(--qr-sub); font-size: 14px; margin-bottom: 24px; }
.qr-name-input {
  width: 100%; padding: 16px; font-size: 18px;
  background: var(--qr-s2); border: 2px solid transparent;
  border-radius: var(--r-md); color: var(--qr-text); outline: none;
  font-family: var(--f-body); text-align: center;
}
.qr-name-input:focus { border-color: var(--qr-accent); }
.qr-name-input::placeholder { color: var(--qr-sub); }
.qr-big-cats { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
.qr-big-cat {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 16px; background: var(--qr-s1);
  border: 1.5px solid var(--qr-s2); border-radius: var(--r-md);
  cursor: pointer; transition: all 0.2s; text-align: left;
  color: var(--qr-text); font-family: var(--f-body);
}
.qr-big-cat:active { transform: scale(0.98); background: var(--qr-s2); }
.qr-big-cat-label { font-size: 17px; font-weight: 600; }
.qr-big-cat-count { font-size: 12px; color: var(--qr-sub); margin-top: 2px; }
.qr-product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.qr-product-card {
  background: var(--qr-s1); border: 1.5px solid var(--qr-s2);
  border-radius: var(--r-md); padding: 14px;
  cursor: pointer; transition: all 0.2s;
  display: flex; flex-direction: column;
}
.qr-product-card.selected { border-color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qr-product-card.out-of-stock { opacity: 0.5; }
.qr-product-name { font-family: var(--f-body); font-size: 15px; font-weight: 500; line-height: 1.3; }
.qr-product-price { font-family: var(--f-mono); font-size: 14px; color: var(--qr-accent); font-weight: 600; margin-top: 4px; }
.qr-product-desc { font-size: 12px; color: var(--qr-sub); margin-top: 4px; }
.qr-product-badge {
  display: inline-block; background: rgba(34,197,94,0.15); color: var(--qr-accent);
  font-family: var(--f-mono); font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 12px; margin-top: 4px;
}
.qr-product-add-btn {
  margin-top: auto; padding-top: 8px; width: 100%;
  padding: 10px; border-radius: var(--r-sm);
  background: var(--qr-accent); color: #050f08;
  font-family: var(--f-disp); font-size: 14px; font-weight: 700;
  border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
  transition: transform 0.1s;
}
.qr-product-add-btn:disabled { background: var(--qr-s2); color: var(--qr-sub); cursor: not-allowed; }
.qr-product-add-btn:active:not(:disabled) { transform: scale(0.97); }
.qr-qty { display: flex; align-items: center; gap: 12px; }
.qr-qty-btn {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--qr-s2); border: 1.5px solid var(--qr-s2);
  color: var(--qr-text); font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.qr-qty-value {
  font-family: var(--f-mono); font-size: 22px; font-weight: 600;
  min-width: 28px; text-align: center;
}
.qr-cart-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px; background: var(--qr-s1); border: 1px solid var(--qr-s2);
  border-radius: var(--r-sm); margin-bottom: 6px;
}
.qr-cart-total {
  font-family: var(--f-mono); font-size: 20px; font-weight: 700;
  color: var(--qr-accent); text-align: right; margin-top: 12px;
}
.qr-mod-option {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; background: var(--qr-s1);
  border: 1.5px solid var(--qr-s2); border-radius: var(--r-sm);
  margin-bottom: 6px; cursor: pointer; color: var(--qr-text);
  font-family: var(--f-body); font-size: 16px;
  transition: all 0.15s;
}
.qr-mod-option.selected { border-color: var(--qr-accent); background: rgba(34,197,94,0.05); }
.qr-mod-option:active { transform: scale(0.98); }
.qr-sub-tabs { display: flex; gap: 6px; padding: 10px 0; flex-wrap: wrap; }
.qr-sub-tab {
  padding: 8px 14px; border-radius: 20px;
  background: var(--qr-s2); border: 1.5px solid var(--qr-s2);
  color: var(--qr-sub); font-family: var(--f-mono); font-size: 12px;
  cursor: pointer; transition: all 0.15s;
}
.qr-sub-tab.active { border-color: var(--qr-accent); color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qr-slot-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.qr-slot-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 20px 16px; border-radius: var(--r-md);
  background: var(--qr-s1); border: 1.5px solid var(--qr-s2);
  color: var(--qr-text); cursor: pointer; transition: all 0.15s;
}
.qr-slot-btn.exists { border-color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qr-slot-btn:active { transform: scale(0.97); }
.qr-slot-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qr-slot-num { font-family: var(--f-disp); font-size: 28px; font-weight: 800; }
.qr-slot-label { font-size: 11px; color: var(--qr-sub); }
.qr-name-btn {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px; border-radius: var(--r-md);
  background: var(--qr-accent); border: none;
  color: #050f08; cursor: pointer; width: 100%;
  font-family: var(--f-disp); font-size: 18px; font-weight: 700;
  transition: transform 0.1s;
}
.qr-name-btn:active { transform: scale(0.98); }
.qr-name-btn-outline {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px; border-radius: var(--r-md);
  background: transparent; border: 1.5px solid var(--qr-s2);
  color: var(--qr-text); cursor: pointer; width: 100%;
  font-family: var(--f-disp); font-size: 18px; font-weight: 700;
  transition: all 0.15s;
}
.qr-name-btn-outline:active { background: var(--qr-s2); transform: scale(0.98); }
.qr-name-btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
.qr-mode-btn {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 24px 16px; border-radius: var(--r-md);
  background: var(--qr-s1); border: 1.5px solid var(--qr-s2);
  color: var(--qr-text); cursor: pointer; width: 100%;
  font-family: var(--f-body); font-size: 17px; font-weight: 600;
  transition: all 0.15s;
}
.qr-mode-btn:active { transform: scale(0.98); background: var(--qr-s2); }
.qr-review-info {
  background: var(--qr-s1); border: 1px solid var(--qr-s2);
  border-radius: var(--r-md); padding: 14px 16px;
}
.qr-cart-remove {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--qr-s2); border: none;
  color: var(--qr-sub); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.qr-cart-remove:active { background: rgba(239,68,68,0.15); color: var(--qr-red); }
.qr-cart-count-bar {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 13px; color: var(--qr-sub); padding: 8px 0;
}
.qr-top-tab {
  flex: 1; padding: 12px 8px; text-align: center;
  font-family: var(--f-disp); font-size: 14px; font-weight: 700;
  border: 1.5px solid var(--qr-s2); border-radius: var(--r-sm);
  cursor: pointer; transition: all 0.15s; color: var(--qr-sub);
  background: var(--qr-s1);
}
.qr-top-tab.active { border-color: var(--qr-accent); color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qr-subcat-tab {
  flex: 1; padding: 10px 8px; text-align: center;
  font-size: 13px; font-weight: 500;
  border: 1px solid var(--qr-s2); border-radius: var(--r-sm);
  cursor: pointer; transition: all 0.15s; color: var(--qr-sub);
  background: var(--qr-s1);
}
.qr-subcat-tab.active { border-color: var(--qr-text); color: var(--qr-text); background: var(--qr-s2); }
.qr-food-tab {
  flex: 1; padding: 12px 8px; text-align: center;
  font-size: 13px; font-weight: 600;
  border: 1.5px solid var(--qr-s2); border-radius: var(--r-sm);
  cursor: pointer; transition: all 0.15s; color: var(--qr-sub);
  background: var(--qr-s1);
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.qr-food-tab.active { border-color: var(--qr-accent); color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qr-cat-toggle {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px; border-radius: var(--r-sm);
  background: transparent; border: none; color: var(--qr-text);
  cursor: pointer; font-family: var(--f-body); font-size: 15px; font-weight: 600;
  transition: background 0.1s;
}
.qr-cat-toggle:active { background: var(--qr-s2); }
.qr-cat-count {
  font-family: var(--f-mono); font-size: 11px; font-weight: 600;
  background: var(--qr-s2); color: var(--qr-sub);
  padding: 2px 8px; border-radius: 12px;
}
.qr-mod-group-label { font-family: var(--f-disp); font-size: 17px; font-weight: 700; margin-bottom: 4px; }
.qr-mod-required {
  display: inline-block; font-family: var(--f-mono); font-size: 10px;
  background: var(--qr-s2); color: var(--qr-sub);
  padding: 2px 8px; border-radius: 12px; margin-left: 8px;
}
.qr-view-menu-header {
  position: sticky; top: 0; z-index: 9999;
  padding: 14px 20px; background: var(--qr-s1);
  display: flex; align-items: center; gap: 12px;
}
.qr-view-top-title {
  font-family: var(--f-disp); font-size: 18px; font-weight: 800;
  color: var(--qr-accent); margin-bottom: 8px;
  border-bottom: 1px solid var(--qr-s2); padding-bottom: 6px;
}
.qr-view-subcat-title {
  font-family: var(--f-mono); font-size: 11px; font-weight: 600;
  color: var(--qr-sub); letter-spacing: 0.08em; text-transform: uppercase;
  margin-bottom: 8px;
}
.qr-view-product-btn {
  padding: 10px; border-radius: var(--r-sm);
  background: var(--qr-s1); border: 1px solid var(--qr-s2);
  cursor: pointer; text-align: left; color: var(--qr-text);
  transition: all 0.15s;
}
.qr-view-product-btn:active { background: var(--qr-s2); }
.qr-center {
  display: flex; align-items: center; justify-content: center;
  min-height: 100dvh; padding: 20px; background: var(--qr-bg);
  color: var(--qr-text);
}
.qr-success-circle {
  width: 80px; height: 80px; border-radius: 50%;
  background: rgba(34,197,94,0.15); display: flex;
  align-items: center; justify-content: center; margin: 0 auto 20px;
}
`;

function QRHeader({
  currentStep,
  totalSteps,
  tableName,
  onBack,
}: {
  currentStep: number;
  totalSteps: number;
  tableName?: string;
  onBack?: () => void;
}) {
  return (
    <div className="qr-header">
      {onBack && (
        <button className="qr-back" onClick={onBack} data-testid="button-step-back">
          <ChevronLeft size={20} />
        </button>
      )}
      <div className="qr-progress">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} className={`qr-dot ${i < currentStep ? "done" : ""}`} />
        ))}
      </div>
      {tableName && <span className="qr-table-chip">{tableName}</span>}
    </div>
  );
}

function QRStepLayout({
  currentStep,
  totalSteps,
  title,
  subtitle,
  tableName,
  children,
  footer,
  onBack,
}: {
  currentStep: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  tableName?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="qr-page">
      <style>{QR_STYLES}</style>
      <QRHeader currentStep={currentStep} totalSteps={totalSteps} tableName={tableName} onBack={onBack} />
      <div className="qr-content">
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <h1 className="qr-step-title" data-testid="text-step-title">{title}</h1>
          {subtitle && <p className="qr-step-sub" data-testid="text-step-subtitle">{subtitle}</p>}
          <p style={{ display: "none" }} data-testid="text-step-progress">Paso {currentStep} de {totalSteps}</p>
          {children}
        </div>
      </div>
      {footer && <div className="qr-footer"><div style={{ maxWidth: 480, margin: "0 auto" }}>{footer}</div></div>}
    </div>
  );
}

function ProductCard({
  product, inCart, outOfStock, loading, onSelect,
}: {
  product: QRProduct;
  inCart: number;
  outOfStock: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`qr-product-card ${outOfStock ? "out-of-stock" : ""} ${inCart > 0 ? "selected" : ""}`} data-testid={`card-product-${product.id}`}>
      <span className="qr-product-name">{product.name}</span>
      <span className="qr-product-price">{formatCurrency(product.price)}</span>
      {inCart > 0 && <span className="qr-product-badge">{inCart}x</span>}
      <button
        className="qr-product-add-btn"
        onClick={onSelect}
        disabled={loading || outOfStock}
        data-testid={`button-add-${product.id}`}
      >
        {outOfStock ? "Agotado" : (<><Plus size={16} /> Agregar</>)}
      </button>
    </div>
  );
}

function BigCategoryButton({
  label, icon, count, onClick, testId,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button className="qr-big-cat" onClick={onClick} data-testid={testId}>
      {icon}
      <div>
        <div className="qr-big-cat-label">{label}</div>
        <div className="qr-big-cat-count">{count} opciones</div>
      </div>
    </button>
  );
}

export default function QRClientPage() {
  const [, params] = useRoute("/qr/:tableCode");
  const tableCode = params?.tableCode || "";
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<Mode>(null);
  const [selectedSubaccount, setSelectedSubaccount] = useState<{ id: number; code: string; slotNumber: number } | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [nameError, setNameError] = useState("");

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedFoodType, setSelectedFoodType] = useState<"bebidas" | "comidas" | "extras">("comidas");
  const [selectedQrTopCode, setSelectedQrTopCode] = useState<string | null>(null);
  const [selectedQrSubcat, setSelectedQrSubcat] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [pendingProduct, setPendingProduct] = useState<QRProduct | null>(null);
  const [modGroups, setModGroups] = useState<QRModifierGroup[]>([]);
  const [selectedMods, setSelectedMods] = useState<Record<number, number[]>>({});
  const [loadingMods, setLoadingMods] = useState(false);

  const [selectedEasyTop, setSelectedEasyTop] = useState<string | null>(null);
  const [viewMenuProduct, setViewMenuProduct] = useState<number | null>(null);

  const totalSteps = mode === "easy" ? 5 : 4;

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<{
    tableId: number;
    tableName: string;
    tableCode: string;
    maxSubaccounts: number;
  }>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const { data: menuData } = useQuery<QRMenuResponse>({
    queryKey: ["/api/qr", tableCode, "menu"],
    queryFn: async () => {
      const res = await fetch(`/api/qr/${tableCode}/menu`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load menu");
      return res.json();
    },
    enabled: !!tableCode && step !== "welcome",
  });
  const menu = menuData?.products || [];
  const qrTopCategories = menuData?.topCategories || [];

  const { data: subaccounts = [], refetch: refetchSubaccounts } = useQuery<Subaccount[]>({
    queryKey: ["/api/qr", tableCode, "subaccounts"],
    enabled: !!tableCode,
  });

  const activeSubaccounts = subaccounts.filter(s => s.isActive);

  const hasQrTopSystem = qrTopCategories.length > 0;

  useEffect(() => {
    if (hasQrTopSystem && qrTopCategories.length > 0 && !selectedQrTopCode) {
      setSelectedQrTopCode(qrTopCategories[0].code);
    }
  }, [hasQrTopSystem, qrTopCategories.length]);

  const subcatsForQrTop = useMemo(() => {
    if (!hasQrTopSystem || !selectedQrTopCode) return [];
    const cats = new Map<string, QRProduct[]>();
    menu.filter(p => p.categoryParentCode === selectedQrTopCode).forEach(p => {
      const c = p.categoryName || "Otros";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(p);
    });
    return Array.from(cats.entries()).map(([name, products]) => ({ name, products }));
  }, [menu, hasQrTopSystem, selectedQrTopCode]);

  useEffect(() => {
    if (subcatsForQrTop.length > 0) {
      setSelectedQrSubcat(subcatsForQrTop[0].name);
    } else {
      setSelectedQrSubcat(null);
    }
  }, [selectedQrTopCode, subcatsForQrTop.length]);

  const filteredProducts = useMemo(() => {
    if (hasQrTopSystem && selectedQrTopCode) {
      if (selectedQrSubcat) {
        return menu.filter(p => p.categoryParentCode === selectedQrTopCode && p.categoryName === selectedQrSubcat);
      }
      return menu.filter(p => p.categoryParentCode === selectedQrTopCode);
    }
    return menu.filter(p => (p.categoryFoodType || "comidas") === selectedFoodType);
  }, [menu, selectedFoodType, hasQrTopSystem, selectedQrTopCode, selectedQrSubcat]);

  const categoriesForFoodType = useMemo(() => {
    if (hasQrTopSystem) return [];
    const cats = new Map<string, QRProduct[]>();
    filteredProducts.forEach(p => {
      const c = p.categoryName || "Otros";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(p);
    });
    return Array.from(cats.entries()).map(([name, products]) => ({ name, products }));
  }, [filteredProducts, hasQrTopSystem]);

  useEffect(() => {
    if (categoriesForFoodType.length > 0) {
      setExpandedCategory(categoriesForFoodType[0].name);
    } else {
      setExpandedCategory(null);
    }
  }, [selectedFoodType, categoriesForFoodType.length]);

  const easyProductsForTop = useMemo(() => {
    if (!selectedEasyTop) return [];
    return menu.filter(p => p.categoryParentCode === selectedEasyTop);
  }, [menu, selectedEasyTop]);

  const viewMenuGrouped = useMemo(() => {
    const topMap = new Map<string, Map<string, QRProduct[]>>();
    menu.forEach(p => {
      const topCode = p.categoryParentCode || "OTHER";
      const subcat = p.categoryName || "Otros";
      if (!topMap.has(topCode)) topMap.set(topCode, new Map());
      const subcatMap = topMap.get(topCode)!;
      if (!subcatMap.has(subcat)) subcatMap.set(subcat, []);
      subcatMap.get(subcat)!.push(p);
    });
    return Array.from(topMap.entries()).map(([topCode, subcatMap]) => {
      const topCat = qrTopCategories.find(t => t.code === topCode);
      return {
        topCode,
        topName: topCat?.name || topCode,
        subcategories: Array.from(subcatMap.entries()).map(([name, products]) => ({ name, products })),
      };
    });
  }, [menu, qrTopCategories]);

  const createSubaccountMutation = useMutation({
    mutationFn: async (slotNum?: number) => {
      const res = await apiRequest("POST", `/api/qr/${tableCode}/subaccounts`, slotNum ? { slotNumber: slotNum } : {});
      return res.json();
    },
    onSuccess: (data: Subaccount) => {
      setSelectedSubaccount({ id: data.id, code: data.code, slotNumber: data.slotNumber });
      queryClient.invalidateQueries({ queryKey: ["/api/qr", tableCode, "subaccounts"] });
      setStep("name");
    },
    onError: (err: Error) => {
      if (err.message.includes("max") || err.message.includes("limit") || err.message.includes("Máximo")) {
        toast({ title: "Límite alcanzado", description: `Ya hay ${MAX_SUBACCOUNTS} cuentas en esta mesa. Usá una existente o pedile al salonero.`, variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la señal un toque. Probá de nuevo.", variant: "destructive" });
      }
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: { subaccountId: number; items: CartItem[] }) => {
      const items = payload.items.map(it => ({
        productId: it.productId,
        productName: it.productName,
        qty: it.qty,
        customerName: it.customerName,
        modifiers: it.modifiers,
      }));
      return apiRequest("POST", `/api/qr/${tableCode}/submit-v2`, {
        subaccountId: payload.subaccountId,
        items,
      });
    },
    onSuccess: () => setStep("sent"),
    onError: (err: Error) => {
      if (err.message.includes("pending") || err.message.includes("confirmando")) {
        toast({ title: "Esperá un momento", description: "El salonero está confirmando pedidos. Apenas confirme, podés enviar el siguiente.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la señal un toque. Probá de nuevo.", variant: "destructive" });
      }
    },
  });

  const handleStartOrder = () => {
    setStep("subaccount");
    refetchSubaccounts();
  };

  const handleSubaccountSelect = (sub: Subaccount) => {
    setSelectedSubaccount({ id: sub.id, code: sub.code, slotNumber: sub.slotNumber });
    if (sub.label) {
      setCustomerName(sub.label);
      setStep("mode_select");
    } else {
      setStep("name");
    }
  };

  const handleNameContinue = () => {
    const trimmed = customerName.trim();
    if (!trimmed) {
      setNameError("Poné tu nombre para que no se nos enrede la cuenta");
      return;
    }
    setNameError("");
    setStep("mode_select");
  };

  const handleProductClick = useCallback(async (product: QRProduct) => {
    if (product.availablePortions !== null && product.availablePortions <= 0) {
      toast({ title: "Agotado", description: "Eso se nos acabó por hoy. Escogé otra opción.", variant: "destructive" });
      return;
    }
    setLoadingMods(true);
    try {
      const res = await fetch(`/api/products/${product.id}/modifiers`);
      const groups: QRModifierGroup[] = await res.json();
      if (groups.length > 0) {
        setPendingProduct(product);
        setModGroups(groups);
        setSelectedMods({});
        setStep("modifiers");
      } else {
        addItemToCart(product, []);
      }
    } catch {
      addItemToCart(product, []);
    } finally {
      setLoadingMods(false);
    }
  }, [customerName, toast]);

  const addItemToCart = (product: QRProduct, mods: { modGroupId: number; optionId: number }[]) => {
    const name = customerName.trim();
    const item: CartItem = {
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      qty: 1,
      customerName: name,
      modifiers: mods.length > 0 ? mods : undefined,
      categoryName: product.categoryName || "Otros",
    };

    setCartItems(prev => {
      const existing = prev.find(it => it.productId === product.id && JSON.stringify(it.modifiers) === JSON.stringify(item.modifiers));
      if (existing) return prev.map(it => it === existing ? { ...it, qty: it.qty + 1 } : it);
      return [...prev, item];
    });
    toast({ title: "Apuntado", description: product.name });
  };

  const confirmModifiers = () => {
    if (!pendingProduct) return;
    for (const group of modGroups) {
      const selected = selectedMods[group.id] || [];
      if (group.required && selected.length === 0) {
        toast({ title: `"${group.name}" es requerido`, variant: "destructive" });
        return;
      }
    }
    const mods: { modGroupId: number; optionId: number }[] = [];
    for (const group of modGroups) {
      for (const optId of (selectedMods[group.id] || [])) {
        mods.push({ modGroupId: group.id, optionId: optId });
      }
    }

    addItemToCart(pendingProduct, mods);

    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    if (mode === "easy") {
      setStep("easy_products");
    } else {
      setStep("menu");
    }
  };

  const handleModifiersBack = () => {
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    if (mode === "easy") {
      setStep("easy_products");
    } else {
      setStep("menu");
    }
  };

  const toggleModOption = (groupId: number, optionId: number, multi: boolean) => {
    setSelectedMods(prev => {
      const current = prev[groupId] || [];
      if (multi) {
        return { ...prev, [groupId]: current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId] };
      }
      return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
    });
  };

  const removeCartItem = (idx: number) => {
    setCartItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!selectedSubaccount) return;
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: cartItems });
  };

  const resetAll = () => {
    setStep("welcome");
    setMode(null);
    setSelectedSubaccount(null);
    setCustomerName("");
    setNameError("");
    setCartItems([]);
    setSelectedFoodType("comidas");
    setExpandedCategory(null);
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setSelectedEasyTop(null);
    setViewMenuProduct(null);
  };

  const cartItemCount = cartItems.reduce((s, it) => s + it.qty, 0);

  if (tableLoading) {
    return (
      <div className="qr-center" data-testid="loading-spinner">
        <style>{QR_STYLES}</style>
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--qr-sub)" }} />
      </div>
    );
  }

  if (tableError || !tableInfo) {
    return (
      <div className="qr-center">
        <style>{QR_STYLES}</style>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <UtensilsCrossed size={48} style={{ margin: "0 auto 16px", color: "var(--qr-sub)" }} />
          <h2 style={{ fontFamily: "var(--f-disp)", fontSize: 20, fontWeight: 800, marginBottom: 8 }} data-testid="text-table-not-found">Mesa no encontrada</h2>
          <p style={{ color: "var(--qr-sub)", fontSize: 14 }}>El código QR no es válido o la mesa no está activa.</p>
        </div>
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="qr-center">
        <style>{QR_STYLES}</style>
        <div style={{ textAlign: "center", maxWidth: 360, width: "100%" }}>
          <UtensilsCrossed size={48} style={{ margin: "0 auto 16px", color: "var(--qr-accent)" }} />
          <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 26, fontWeight: 800, marginBottom: 8 }} data-testid="text-table-name">{tableInfo.tableName}</h1>
          <p style={{ color: "var(--qr-sub)", fontSize: 16, marginBottom: 32 }} data-testid="text-welcome-message">Bienvenido! Pedí fácil y sin carrera.</p>
          <button className="qr-cta" onClick={handleStartOrder} data-testid="button-start-order">
            <ChefHat size={24} />
            Empezar a pedir
          </button>
          <p style={{ color: "var(--qr-sub)", fontSize: 12, marginTop: 16 }} data-testid="text-welcome-note">
            Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina.
          </p>
        </div>
      </div>
    );
  }

  if (step === "subaccount") {
    const maxSlots = tableInfo?.maxSubaccounts ?? MAX_SUBACCOUNTS;
    const namedSubaccounts = activeSubaccounts.filter(s => s.label);
    const hasNamedSubs = namedSubaccounts.length > 0;
    const canAddMore = activeSubaccounts.length < maxSlots;

    const handleAddComensal = () => {
      const usedSlots = new Set(activeSubaccounts.map(s => s.slotNumber));
      let nextSlot = 1;
      for (let i = 1; i <= maxSlots; i++) {
        if (!usedSlots.has(i)) { nextSlot = i; break; }
      }
      createSubaccountMutation.mutate(nextSlot);
    };

    if (hasNamedSubs) {
      return (
        <QRStepLayout
          currentStep={1} totalSteps={totalSteps}
          title="¿Quién sos?"
          subtitle="Escogé tu nombre o agregá un comensal nuevo."
          tableName={tableInfo.tableName}
          onBack={() => setStep("welcome")}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {namedSubaccounts.map(sub => (
              <button
                key={sub.id}
                className="qr-name-btn"
                onClick={() => handleSubaccountSelect(sub)}
                data-testid={`button-sub-name-${sub.id}`}
              >
                <User size={24} />
                <span>{sub.label}</span>
              </button>
            ))}
            {canAddMore && (
              <button
                className="qr-name-btn-outline"
                onClick={handleAddComensal}
                disabled={createSubaccountMutation.isPending}
                data-testid="button-add-comensal"
              >
                {createSubaccountMutation.isPending ? <Loader2 size={24} className="animate-spin" /> : <Plus size={24} />}
                <span>Agregar comensal</span>
              </button>
            )}
          </div>
        </QRStepLayout>
      );
    }

    const slotNumbers = Array.from({ length: maxSlots }, (_, i) => i + 1);
    const existingSlots = new Map(activeSubaccounts.map(s => [s.slotNumber, s]));

    const handleSlotClick = async (slotNum: number) => {
      const existing = existingSlots.get(slotNum);
      if (existing) {
        handleSubaccountSelect(existing);
      } else {
        createSubaccountMutation.mutate(slotNum);
      }
    };

    return (
      <QRStepLayout
        currentStep={1} totalSteps={totalSteps}
        title="Escogé tu subcuenta"
        subtitle="Después ordená lo que querás."
        tableName={tableInfo.tableName}
        onBack={() => setStep("welcome")}
      >
        <div className="qr-slot-grid">
          {slotNumbers.map(n => {
            const exists = existingSlots.has(n);
            return (
              <button
                key={n}
                className={`qr-slot-btn ${exists ? "exists" : ""}`}
                onClick={() => handleSlotClick(n)}
                disabled={createSubaccountMutation.isPending}
                data-testid={`button-slot-${n}`}
              >
                <span className="qr-slot-num">{n}</span>
                <span className="qr-slot-label">{exists ? "Cuenta activa" : "Cuenta nueva"}</span>
              </button>
            );
          })}
        </div>
        {createSubaccountMutation.isPending && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", color: "var(--qr-sub)", fontSize: 13 }}>
            <Loader2 size={16} className="animate-spin" />
            <span>Creando cuenta...</span>
          </div>
        )}
      </QRStepLayout>
    );
  }

  if (step === "name") {
    return (
      <QRStepLayout
        currentStep={2} totalSteps={totalSteps}
        title="¿Cómo te llamás?"
        subtitle="Así el salonero lo lee clarito."
        tableName={tableInfo.tableName}
        onBack={() => setStep("subaccount")}
        footer={
          <button className="qr-cta" onClick={handleNameContinue} data-testid="button-name-continue">
            Continuar
            <ArrowRight size={22} />
          </button>
        }
      >
        <div style={{ paddingTop: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <User size={56} style={{ color: "var(--qr-accent)" }} />
          <input
            className="qr-name-input"
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setNameError(""); }}
            placeholder="Tu nombre"
            autoFocus
            data-testid="input-customer-name"
          />
          {nameError && (
            <p style={{ color: "var(--qr-red)", fontSize: 14, textAlign: "center" }} data-testid="text-name-error">{nameError}</p>
          )}
        </div>
      </QRStepLayout>
    );
  }

  if (step === "mode_select") {
    return (
      <QRStepLayout
        currentStep={3} totalSteps={totalSteps}
        title="¿Cómo preferís ordenar?"
        subtitle="Escogé tu modo."
        tableName={tableInfo.tableName}
        onBack={() => setStep("name")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
          <button className="qr-mode-btn" onClick={() => { setMode("easy"); setStep("easy_cats"); }} data-testid="button-mode-easy">
            <ChefHat size={28} />
            <span>Modo Fácil</span>
          </button>
          <button className="qr-mode-btn" onClick={() => { setMode("standard"); setStep("menu"); }} data-testid="button-mode-standard">
            <Utensils size={28} />
            <span>Modo Estándar</span>
          </button>
          <button className="qr-mode-btn" onClick={() => { setMode("view_menu"); setStep("view_menu"); }} data-testid="button-mode-view-menu">
            <UtensilsCrossed size={28} />
            <span>Ver Menú</span>
          </button>
        </div>
      </QRStepLayout>
    );
  }

  if (step === "easy_cats") {
    const topIconMap: Record<string, React.ReactNode> = {
      "TOP-COMIDAS": <ChefHat size={24} />,
      "TOP-BEBIDAS": <Coffee size={24} />,
      "TOP-POSTRES": <Utensils size={24} />,
    };

    return (
      <QRStepLayout
        currentStep={3} totalSteps={5}
        title="¿Qué se te antoja?"
        tableName={tableInfo.tableName}
        onBack={() => setStep("mode_select")}
        footer={
          <div>
            {cartItemCount > 0 && (
              <div className="qr-cart-count-bar" data-testid="text-easy-cart-count">
                <ShoppingBag size={16} />
                <span>{cartItemCount} item{cartItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <button className="qr-cta" onClick={() => setStep("easy_review")} disabled={cartItemCount === 0} data-testid="button-easy-review">
              Revisar pedido
              <ArrowRight size={22} />
            </button>
          </div>
        }
      >
        <div className="qr-big-cats">
          {qrTopCategories.map(top => {
            const count = menu.filter(p => p.categoryParentCode === top.code).length;
            return (
              <BigCategoryButton
                key={top.code}
                label={top.name}
                icon={topIconMap[top.code] || <BookOpen size={24} />}
                count={count}
                onClick={() => { setSelectedEasyTop(top.code); setStep("easy_products"); }}
                testId={`button-easy-top-${top.code}`}
              />
            );
          })}
        </div>
      </QRStepLayout>
    );
  }

  if (step === "easy_products") {
    const topName = qrTopCategories.find(t => t.code === selectedEasyTop)?.name || "Productos";

    return (
      <QRStepLayout
        currentStep={4} totalSteps={5}
        title={topName}
        tableName={tableInfo.tableName}
        onBack={() => setStep("easy_cats")}
        footer={
          <div>
            {cartItemCount > 0 && (
              <div className="qr-cart-count-bar" data-testid="text-easy-products-cart-count">
                <ShoppingBag size={16} />
                <span>{cartItemCount} item{cartItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <button className="qr-cta-outline" onClick={() => setStep("easy_cats")} data-testid="button-back-to-cats">
              <ChevronLeft size={20} />
              Volver a categorías
            </button>
          </div>
        }
      >
        {easyProductsForTop.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Utensils size={48} style={{ margin: "0 auto 12px", color: "var(--qr-sub)" }} />
            <p style={{ color: "var(--qr-sub)", fontSize: 16 }}>No hay productos disponibles.</p>
          </div>
        ) : (
          <div className="qr-product-grid">
            {easyProductsForTop.map(product => {
              const inCart = cartItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
              const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
              return (
                <ProductCard
                  key={product.id}
                  product={product}
                  inCart={inCart}
                  outOfStock={outOfStock}
                  loading={loadingMods}
                  onSelect={() => handleProductClick(product)}
                />
              );
            })}
          </div>
        )}
      </QRStepLayout>
    );
  }

  if (step === "easy_review") {
    return (
      <QRStepLayout
        currentStep={5} totalSteps={5}
        title="Revisá tu pedido"
        tableName={tableInfo.tableName}
        onBack={() => setStep("easy_cats")}
        footer={
          <button className="qr-cta" onClick={handleSubmit} disabled={submitMutation.isPending || cartItems.length === 0} data-testid="button-easy-confirm-order">
            {submitMutation.isPending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />}
            Confirmar y enviar
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="qr-review-info">
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--qr-sub)", fontSize: 14 }} data-testid="text-easy-review-account">
              <Users size={18} />
              <span>Cuenta: {tableInfo.tableName}-{selectedSubaccount?.slotNumber}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginTop: 6 }} data-testid="text-easy-review-name">
              <User size={18} style={{ color: "var(--qr-sub)" }} />
              <span style={{ color: "var(--qr-sub)" }}>Nombre:</span>
              <strong>{customerName.trim()}</strong>
            </div>
          </div>

          {cartItems.length > 0 ? (
            <>
              {cartItems.map((item, idx) => (
                <div className="qr-cart-item" key={idx} data-testid={`easy-review-item-${idx}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: 15 }}>{item.qty}x {item.productName}</p>
                    <p style={{ color: "var(--qr-sub)", fontSize: 13, marginTop: 2 }}>
                      {formatCurrency(item.unitPrice)} c/u
                    </p>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <p style={{ color: "var(--qr-sub)", fontSize: 12, marginTop: 2 }}>
                        {item.modifiers.length} modificador{item.modifiers.length !== 1 ? "es" : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 600, fontSize: 14, color: "var(--qr-accent)", whiteSpace: "nowrap" }} data-testid={`text-easy-item-subtotal-${idx}`}>
                      {formatCurrency(Number(item.unitPrice) * item.qty)}
                    </span>
                    <button className="qr-cart-remove" onClick={() => removeCartItem(idx)} data-testid={`button-easy-remove-item-${idx}`}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", background: "var(--qr-s1)", border: "1px solid var(--qr-s2)", borderRadius: "var(--r-sm)" }}>
                <span style={{ fontFamily: "var(--f-disp)", fontSize: 16, fontWeight: 700 }}>Total</span>
                <span className="qr-cart-total" style={{ marginTop: 0 }} data-testid="text-easy-order-total">
                  {formatCurrency(cartItems.reduce((sum, i) => sum + Number(i.unitPrice) * i.qty, 0))}
                </span>
              </div>
            </>
          ) : (
            <p style={{ textAlign: "center", color: "var(--qr-sub)", fontSize: 15, padding: "24px 0" }} data-testid="text-easy-empty-order">No hay items en tu pedido.</p>
          )}

          <button className="qr-cta-outline" onClick={() => setStep("easy_cats")} data-testid="button-easy-add-more">
            <Plus size={20} />
            Agregar algo más
          </button>
        </div>
      </QRStepLayout>
    );
  }

  if (step === "menu") {
    const foodTypeLabels: { key: "bebidas" | "comidas" | "extras"; label: string; icon: React.ReactNode }[] = [
      { key: "bebidas", label: "Bebidas", icon: <Coffee size={16} /> },
      { key: "comidas", label: "Comidas", icon: <ChefHat size={16} /> },
      { key: "extras", label: "Extras", icon: <Utensils size={16} /> },
    ];

    return (
      <div className="qr-page" style={{ paddingBottom: 120 }}>
        <style>{QR_STYLES}</style>
        <div className="qr-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="qr-back" onClick={() => setStep("mode_select")} data-testid="button-step-back">
              <ChevronLeft size={20} />
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ display: "none" }} data-testid="text-step-progress">Paso 3 de {totalSteps}</p>
              <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, fontWeight: 800 }} data-testid="text-step-title">¿Qué querés pedir?</h1>
            </div>
            <span className="qr-table-chip">{tableInfo.tableName}</span>
          </div>

          {hasQrTopSystem ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {qrTopCategories.map((top) => (
                  <button
                    key={top.code}
                    className={`qr-top-tab ${selectedQrTopCode === top.code ? "active" : ""}`}
                    onClick={() => setSelectedQrTopCode(top.code)}
                    data-testid={`button-qr-top-${top.code}`}
                  >
                    {top.name}
                  </button>
                ))}
              </div>
              {subcatsForQrTop.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {subcatsForQrTop.map(({ name: catName, products: catProducts }) => (
                    <button
                      key={catName}
                      className={`qr-subcat-tab ${selectedQrSubcat === catName ? "active" : ""}`}
                      onClick={() => setSelectedQrSubcat(catName)}
                      data-testid={`button-qr-subcat-${catName}`}
                    >
                      {catName} ({catProducts.length})
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              {foodTypeLabels.map(ft => (
                <button
                  key={ft.key}
                  className={`qr-food-tab ${selectedFoodType === ft.key ? "active" : ""}`}
                  onClick={() => setSelectedFoodType(ft.key)}
                  data-testid={`button-food-type-${ft.key}`}
                >
                  {ft.icon}
                  {ft.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="qr-content" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            {hasQrTopSystem ? (
              filteredProducts.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <Utensils size={48} style={{ margin: "0 auto 12px", color: "var(--qr-sub)" }} />
                  <p style={{ color: "var(--qr-sub)", fontSize: 16 }}>No hay productos disponibles.</p>
                </div>
              ) : (
                <div className="qr-product-grid">
                  {filteredProducts.map(product => {
                    const inCart = cartItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
                    const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
                    return (
                      <ProductCard
                        key={product.id}
                        product={product}
                        inCart={inCart}
                        outOfStock={outOfStock}
                        loading={loadingMods}
                        onSelect={() => handleProductClick(product)}
                      />
                    );
                  })}
                </div>
              )
            ) : categoriesForFoodType.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <Utensils size={48} style={{ margin: "0 auto 12px", color: "var(--qr-sub)" }} />
                <p style={{ color: "var(--qr-sub)", fontSize: 16 }}>No hay productos disponibles en esta categoría.</p>
              </div>
            ) : (
              <div>
                {categoriesForFoodType.map(({ name: catName, products: catProducts }) => {
                  const isExpanded = expandedCategory === catName;
                  return (
                    <div key={catName} data-testid={`category-group-${catName}`}>
                      <button
                        className="qr-cat-toggle"
                        onClick={() => setExpandedCategory(isExpanded ? null : catName)}
                        aria-expanded={isExpanded}
                        data-testid={`button-toggle-category-${catName}`}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          {isExpanded
                            ? <ChevronDown size={16} style={{ color: "var(--qr-sub)", flexShrink: 0 }} />
                            : <ChevronRight size={16} style={{ color: "var(--qr-sub)", flexShrink: 0 }} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName}</span>
                        </div>
                        <span className="qr-cat-count">{catProducts.length}</span>
                      </button>
                      {isExpanded && (
                        <div style={{ padding: "4px 4px 16px" }}>
                          <div className="qr-product-grid">
                            {catProducts.map(product => {
                              const inCart = cartItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
                              const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
                              return (
                                <ProductCard
                                  key={product.id}
                                  product={product}
                                  inCart={inCart}
                                  outOfStock={outOfStock}
                                  loading={loadingMods}
                                  onSelect={() => handleProductClick(product)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="qr-footer" style={{ position: "fixed", left: 0, right: 0 }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            {cartItemCount > 0 && (
              <div className="qr-cart-count-bar" data-testid="text-cart-count">
                <ShoppingBag size={16} />
                <span>{cartItemCount} item{cartItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <button className="qr-cta" onClick={() => setStep("review")} disabled={cartItemCount === 0} data-testid="button-review-order">
              Revisar pedido
              <ArrowRight size={22} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "modifiers") {
    return (
      <QRStepLayout
        currentStep={mode === "easy" ? 4 : 3} totalSteps={totalSteps}
        title={`¿Cómo preferís tu ${pendingProduct?.name}?`}
        tableName={tableInfo.tableName}
        onBack={handleModifiersBack}
        footer={
          <button className="qr-cta" onClick={() => confirmModifiers()} data-testid="button-confirm-modifiers">
            Confirmar
            <ArrowRight size={22} />
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {modGroups.map(group => (
            <div key={group.id} data-testid={`modifier-group-${group.id}`}>
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <span className="qr-mod-group-label">{group.name}</span>
                {group.required && <span className="qr-mod-required">Requerido</span>}
                {group.multiSelect && <span style={{ fontSize: 12, color: "var(--qr-sub)", marginLeft: 8 }}>(varias opciones)</span>}
              </div>
              <div>
                {group.options.map(opt => {
                  const isSelected = (selectedMods[group.id] || []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      className={`qr-mod-option ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleModOption(group.id, opt.id, group.multiSelect)}
                      data-testid={`button-modifier-${opt.id}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                        {isSelected && <CheckCircle2 size={20} style={{ color: "var(--qr-accent)", flexShrink: 0 }} />}
                        <span>{opt.name}</span>
                      </div>
                      {Number(opt.priceDelta) !== 0 && (
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--qr-accent)", fontWeight: 600 }}>
                          +{formatCurrency(opt.priceDelta)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {!group.required && (
                  <button
                    className={`qr-mod-option ${(selectedMods[group.id] || []).length === 0 ? "selected" : ""}`}
                    onClick={() => setSelectedMods(prev => ({ ...prev, [group.id]: [] }))}
                    data-testid={`button-modifier-skip-${group.id}`}
                  >
                    <span>No gracias</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </QRStepLayout>
    );
  }

  if (step === "review") {
    return (
      <QRStepLayout
        currentStep={4} totalSteps={totalSteps}
        title="Revisá tu pedido"
        tableName={tableInfo.tableName}
        onBack={() => setStep("menu")}
        footer={
          <button className="qr-cta" onClick={handleSubmit} disabled={submitMutation.isPending || cartItems.length === 0} data-testid="button-confirm-order">
            {submitMutation.isPending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />}
            Confirmar y enviar
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="qr-review-info">
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--qr-sub)", fontSize: 14 }} data-testid="text-review-account">
              <Users size={18} />
              <span>Cuenta: {tableInfo.tableName}-{selectedSubaccount?.slotNumber}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginTop: 6 }} data-testid="text-review-name">
              <User size={18} style={{ color: "var(--qr-sub)" }} />
              <span style={{ color: "var(--qr-sub)" }}>Nombre:</span>
              <strong>{customerName.trim()}</strong>
            </div>
          </div>

          {cartItems.length > 0 ? (
            <>
              {cartItems.map((item, idx) => (
                <div className="qr-cart-item" key={idx} data-testid={`review-item-${idx}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: 15 }}>{item.qty}x {item.productName}</p>
                    <p style={{ color: "var(--qr-sub)", fontSize: 13, marginTop: 2 }}>
                      {formatCurrency(item.unitPrice)} c/u
                    </p>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <p style={{ color: "var(--qr-sub)", fontSize: 12, marginTop: 2 }}>
                        {item.modifiers.length} modificador{item.modifiers.length !== 1 ? "es" : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 600, fontSize: 14, color: "var(--qr-accent)", whiteSpace: "nowrap" }} data-testid={`text-item-subtotal-${idx}`}>
                      {formatCurrency(Number(item.unitPrice) * item.qty)}
                    </span>
                    <button className="qr-cart-remove" onClick={() => removeCartItem(idx)} data-testid={`button-remove-item-${idx}`}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", background: "var(--qr-s1)", border: "1px solid var(--qr-s2)", borderRadius: "var(--r-sm)" }}>
                <span style={{ fontFamily: "var(--f-disp)", fontSize: 16, fontWeight: 700 }}>Total</span>
                <span className="qr-cart-total" style={{ marginTop: 0 }} data-testid="text-order-total">
                  {formatCurrency(cartItems.reduce((sum, i) => sum + Number(i.unitPrice) * i.qty, 0))}
                </span>
              </div>
            </>
          ) : (
            <p style={{ textAlign: "center", color: "var(--qr-sub)", fontSize: 15, padding: "24px 0" }} data-testid="text-empty-order">No hay items en tu pedido.</p>
          )}

          <button className="qr-cta-outline" onClick={() => setStep("menu")} data-testid="button-add-more">
            <Plus size={20} />
            Agregar algo más
          </button>
        </div>
      </QRStepLayout>
    );
  }

  if (step === "view_menu") {
    const expandedProduct = viewMenuProduct !== null ? menu.find(p => p.id === viewMenuProduct) : null;

    if (expandedProduct) {
      return (
        <div className="qr-page">
          <style>{QR_STYLES}</style>
          <div className="qr-view-menu-header">
            <button className="qr-back" onClick={() => setViewMenuProduct(null)} data-testid="button-view-product-back">
              <ChevronLeft size={20} />
            </button>
            <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 18, fontWeight: 800, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="text-view-product-title">{expandedProduct.name}</h1>
          </div>
          <div className="qr-content" style={{ paddingTop: 24 }}>
            <div style={{ maxWidth: 480, margin: "0 auto" }}>
              <h2 style={{ fontFamily: "var(--f-disp)", fontSize: 24, fontWeight: 800, marginBottom: 8 }} data-testid="text-view-product-name">{expandedProduct.name}</h2>
              <p style={{ fontFamily: "var(--f-mono)", fontSize: 20, fontWeight: 600, color: "var(--qr-accent)", marginBottom: 16 }} data-testid="text-view-product-price">
                {formatCurrency(expandedProduct.price)}
              </p>
              {expandedProduct.description && (
                <p style={{ color: "var(--qr-sub)", fontSize: 15, lineHeight: 1.6 }} data-testid="text-view-product-description">
                  {expandedProduct.description}
                </p>
              )}
            </div>
          </div>
          <div className="qr-footer">
            <div style={{ maxWidth: 480, margin: "0 auto" }}>
              <button className="qr-cta-outline" onClick={() => setViewMenuProduct(null)} data-testid="button-view-product-close">
                Volver al menú
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="qr-page">
        <style>{QR_STYLES}</style>
        <div className="qr-view-menu-header">
          <button className="qr-back" onClick={() => setStep("mode_select")} data-testid="button-view-menu-back">
            <ChevronLeft size={20} />
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, fontWeight: 800 }} data-testid="text-view-menu-title">Menú</h1>
            <p style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--qr-sub)" }} data-testid="text-view-menu-table">{tableInfo.tableName}</p>
          </div>
          <div style={{ width: 40 }} />
        </div>

        <div className="qr-content" style={{ paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            {viewMenuGrouped.map(({ topCode, topName, subcategories }) => (
              <div key={topCode} style={{ marginBottom: 24 }} data-testid={`view-menu-top-${topCode}`}>
                <h2 className="qr-view-top-title" data-testid={`text-view-top-${topCode}`}>
                  {topName}
                </h2>
                {subcategories.map(({ name: subcatName, products: subcatProducts }) => (
                  <div key={subcatName} style={{ marginBottom: 16 }} data-testid={`view-menu-subcat-${subcatName}`}>
                    <h3 className="qr-view-subcat-title" data-testid={`text-view-subcat-${subcatName}`}>
                      {subcatName}
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      {subcatProducts.map(product => (
                        <button
                          key={product.id}
                          className="qr-view-product-btn"
                          onClick={() => setViewMenuProduct(product.id)}
                          data-testid={`button-view-product-${product.id}`}
                        >
                          <p style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.3 }}>{product.name}</p>
                          <p style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600, color: "var(--qr-accent)", marginTop: 4 }}>
                            {formatCurrency(product.price)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {viewMenuGrouped.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <BookOpen size={48} style={{ margin: "0 auto 12px", color: "var(--qr-sub)" }} />
                <p style={{ color: "var(--qr-sub)", fontSize: 16 }}>Menú no disponible.</p>
              </div>
            )}
          </div>
        </div>

        <div className="qr-footer">
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <button className="qr-cta-outline" onClick={() => setStep("mode_select")} data-testid="button-view-menu-volver">
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "sent") {
    return (
      <div className="qr-center" style={{ flexDirection: "column" }}>
        <style>{QR_STYLES}</style>
        <div style={{ textAlign: "center", maxWidth: 360, width: "100%" }}>
          <div className="qr-success-circle">
            <Check size={40} style={{ color: "var(--qr-accent)" }} />
          </div>
          <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 26, fontWeight: 800, marginBottom: 8 }} data-testid="text-order-sent">Pedido enviado</h1>
          <p style={{ color: "var(--qr-sub)", fontSize: 16, marginBottom: 8 }} data-testid="text-order-sent-message">
            Ya viene un salonero a confirmarles la orden.
          </p>
          <p style={{ color: "var(--qr-sub)", fontSize: 14, marginBottom: 32 }}>Gracias por la paciencia, y buen provecho!</p>
          <button className="qr-cta" onClick={resetAll} data-testid="button-new-order">
            <Plus size={22} />
            Hacer otro pedido
          </button>
        </div>
      </div>
    );
  }

  return null;
}
