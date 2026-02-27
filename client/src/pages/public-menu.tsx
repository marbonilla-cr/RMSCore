import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";
import placeholderImg from "@assets/image_1772129930201.png";
import { UtensilsCrossed, Coffee, Loader2 } from "lucide-react";

interface TopCategory {
  id: number;
  categoryCode: string;
  name: string;
  sortOrder: number;
  foodType: string;
}

interface Subcategory {
  id: number;
  categoryCode: string;
  name: string;
  parentCategoryCode: string;
  sortOrder: number;
}

interface Product {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryId: number;
  imageUrl: string | null;
  availablePortions: number | null;
}

interface MenuData {
  topCategories: TopCategory[];
  subcategories: Subcategory[];
  products: Product[];
}

function formatPrice(price: string) {
  const num = parseFloat(price);
  return `₡${num.toLocaleString("es-CR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function ProductCard({ product }: { product: Product }) {
  const [imgError, setImgError] = useState(false);
  const soldOut = product.availablePortions !== null && product.availablePortions <= 0;

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-shadow hover:shadow-md ${soldOut ? "opacity-50" : ""}`}
      style={{
        background: "var(--card)",
        borderColor: "var(--border)",
      }}
      data-testid={`card-product-${product.id}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: "var(--muted)" }}>
        {product.imageUrl && !imgError ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-6">
            <img src={placeholderImg} alt="" className="w-12 h-12 opacity-30" />
          </div>
        )}
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="text-white font-bold text-sm px-3 py-1 rounded-full bg-red-600">Agotado</span>
          </div>
        )}
      </div>

      <div className="p-3">
        <h3
          className="font-semibold text-sm leading-tight mb-1 line-clamp-2"
          style={{ color: "var(--foreground)", fontFamily: "var(--font-display)" }}
          data-testid={`text-product-name-${product.id}`}
        >
          {product.name}
        </h3>
        {product.description && (
          <p
            className="text-xs leading-snug mb-2 line-clamp-2"
            style={{ color: "var(--muted-foreground)" }}
          >
            {product.description}
          </p>
        )}
        <p
          className="font-bold text-sm"
          style={{ color: "var(--acc)", fontFamily: "var(--font-mono)" }}
          data-testid={`text-price-${product.id}`}
        >
          {formatPrice(product.price)}
        </p>
      </div>
    </div>
  );
}

export default function PublicMenuPage() {
  const { data, isLoading, error } = useQuery<MenuData>({
    queryKey: ["/api/public/menu"],
  });

  const [activeTopCode, setActiveTopCode] = useState<string | null>(null);

  const selectedTop = activeTopCode ?? data?.topCategories?.[0]?.categoryCode ?? null;

  const groupedMenu = useMemo(() => {
    if (!data || !selectedTop) return [];

    const subs = data.subcategories
      .filter(s => s.parentCategoryCode === selectedTop)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const subCategoryIds = new Set<number>();
    const subMap = new Map<number, Subcategory>();
    for (const sub of subs) {
      subCategoryIds.add(sub.id);
      subMap.set(sub.id, sub);
    }

    const groups: { subcategory: Subcategory; products: Product[] }[] = [];

    for (const sub of subs) {
      const prods = data.products
        .filter(p => p.categoryId === sub.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (prods.length > 0) {
        groups.push({ subcategory: sub, products: prods });
      }
    }

    return groups;
  }, [data, selectedTop]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--acc)" }} />
          <p style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-body)" }}>Cargando menú...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <p style={{ color: "var(--coral)" }}>Error al cargar el menú</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-sm"
        style={{
          background: "color-mix(in srgb, var(--bg) 90%, transparent)",
          borderColor: "var(--border)",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <img
            src={logoImg}
            alt="La Antigua Lechería"
            className="w-10 h-10 rounded-full object-cover"
            data-testid="img-menu-logo"
          />
          <div>
            <h1
              className="text-lg font-bold leading-tight"
              style={{ color: "var(--foreground)", fontFamily: "var(--font-display)" }}
              data-testid="text-restaurant-name"
            >
              La Antigua Lechería
            </h1>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Nuestro Menú
            </p>
          </div>
        </div>

        {data.topCategories.length > 1 && (
          <div className="max-w-5xl mx-auto px-4 pb-2">
            <nav className="flex gap-2 overflow-x-auto no-scrollbar" data-testid="nav-top-categories">
              {data.topCategories
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map(tc => {
                  const isActive = tc.categoryCode === selectedTop;
                  const Icon = tc.foodType === "bebidas" ? Coffee : UtensilsCrossed;
                  return (
                    <button
                      key={tc.categoryCode}
                      onClick={() => setActiveTopCode(tc.categoryCode)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
                      style={{
                        background: isActive ? "var(--acc)" : "var(--muted)",
                        color: isActive ? "#fff" : "var(--muted-foreground)",
                        fontFamily: "var(--font-display)",
                      }}
                      data-testid={`btn-top-category-${tc.categoryCode}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tc.name}
                    </button>
                  );
                })}
            </nav>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {groupedMenu.length === 0 ? (
          <div className="text-center py-16">
            <UtensilsCrossed className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
            <p style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-body)" }}>
              No hay productos disponibles en esta categoría
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedMenu.map(group => (
              <section key={group.subcategory.id}>
                <h2
                  className="text-base font-bold mb-3 pb-1 border-b"
                  style={{
                    color: "var(--foreground)",
                    borderColor: "var(--border)",
                    fontFamily: "var(--font-display)",
                  }}
                  data-testid={`text-subcategory-${group.subcategory.id}`}
                >
                  {group.subcategory.name}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {group.products.map(product => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t py-6 mt-8" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-4 flex flex-col items-center gap-2">
          <img src={logoImg} alt="La Antigua Lechería" className="w-8 h-8 rounded-full object-cover" />
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            © {new Date().getFullYear()} La Antigua Lechería · Menú informativo
          </p>
        </div>
      </footer>
    </div>
  );
}
