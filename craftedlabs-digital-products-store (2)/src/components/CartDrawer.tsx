import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { safeMediaUrl } from '../lib/sanitize';

export default function CartDrawer() {
  const {
    cart,
    products,
    cartDrawerOpen,
    setCartDrawerOpen,
    updateCartQty,
    removeFromCart,
    cartSubtotal,
  } = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cartDrawerOpen) {
        setCartDrawerOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cartDrawerOpen, setCartDrawerOpen]);

  const enrichedItems = cart
    .map((item) => ({
      ...item,
      product: products.find((p) => p.id === item.productId),
    }))
    .filter((entry) => entry.product !== undefined);

  if (!cartDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-70 flex justify-end">
      <div
        className="fixed inset-0 bg-[#23242B]/45 backdrop-blur-xs"
        onClick={() => setCartDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className="relative z-80 w-full max-w-[420px] h-full bg-[#FAF9F5] border-l border-[#E5E2D8] flex flex-col shadow-2xl drawer-panel"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E2D8]">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-[#E56B5D]" />
            <h2
              id="cart-drawer-title"
              className="font-serif-editorial font-medium text-xl text-[#23242B]"
            >
              Your Bag
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setCartDrawerOpen(false)}
            aria-label="Close cart drawer"
            className="w-9 h-9 rounded-full border border-[#E5E2D8] flex items-center justify-center text-[#23242B] hover:bg-[#EAE6DA] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {enrichedItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-[#F3F1EA] border border-[#E5E2D8] flex items-center justify-center text-[#E56B5D] mb-4">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <p className="font-serif-editorial font-medium text-lg text-[#23242B]">
                Your bag is empty
              </p>
              <p className="text-sm text-[#6B6A64] mt-1.5 max-w-[26ch]">
                Explore SoloBiz OS, digital templates, and practical workbooks.
              </p>
              <Link
                to="/shop"
                onClick={() => setCartDrawerOpen(false)}
                className="mt-6 inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold btn-tactile"
              >
                Browse Store
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              {enrichedItems.map(({ productId, qty, product }) => {
                if (!product) return null;
                return (
                  <div
                    key={productId}
                    className="flex gap-4 pb-5 border-b border-[#E5E2D8]"
                  >
                    <img
                      src={safeMediaUrl(product.image)}
                      alt={product.imageAlt}
                      referrerPolicy="no-referrer"
                      className="w-20 h-16 object-cover rounded-lg border border-[#E5E2D8] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/product/${product.slug}`}
                          onClick={() => setCartDrawerOpen(false)}
                          className="font-semibold text-sm text-[#23242B] hover:text-[#E56B5D] truncate"
                        >
                          {product.title}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeFromCart(productId)}
                          aria-label={`Remove ${product.title}`}
                          className="text-[#6B6A64] hover:text-[#E56B5D] cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-[#6B6A64] mt-0.5 truncate">
                        {product.productType}
                      </p>
                      <div className="flex items-center justify-between mt-3">
                        <div className="inline-flex items-center gap-2 border border-[#E5E2D8] bg-white rounded-full px-2 py-0.5">
                          <button
                            type="button"
                            onClick={() => updateCartQty(productId, -1)}
                            aria-label="Decrease quantity"
                            className="w-6 h-6 flex items-center justify-center text-[#23242B] cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-mono-tabular text-xs font-semibold w-4 text-center">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(productId, 1)}
                            aria-label="Increase quantity"
                            className="w-6 h-6 flex items-center justify-center text-[#23242B] cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <span className="font-mono-tabular font-bold text-sm text-[#23242B]">
                          {product.price === 0
                            ? 'Free'
                            : `$${(product.price * qty).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {enrichedItems.length > 0 && (
          <div className="p-6 border-t border-[#E5E2D8] bg-[#F3F1EA]">
            <p className="text-[11px] font-medium text-[#E56B5D] mb-2">
              Payments coming soon — all eBooks are currently free.
            </p>
            <div className="flex items-center justify-between text-sm text-[#6B6A64] mb-1.5">
              <span>Digital Delivery</span>
              <span>Instant free download</span>
            </div>
            <div className="flex items-center justify-between text-lg font-bold text-[#23242B] mb-5">
              <span>Total</span>
              <span className="font-mono-tabular">
                {cartSubtotal === 0
                  ? 'Free ($0.00)'
                  : `$${cartSubtotal.toFixed(2)} USD`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                navigate('/checkout');
              }}
              className="w-full py-3.5 px-6 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] font-semibold text-sm btn-tactile cursor-pointer"
            >
              Continue to Checkout
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
