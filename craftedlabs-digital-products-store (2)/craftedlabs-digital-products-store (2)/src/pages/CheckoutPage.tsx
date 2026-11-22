import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Lock,
  ShoppingBag,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { useStore } from '../context/StoreContext';
import {
  DEMO_PAYMENT_PROVIDERS,
  downloadVerifiedProductPackage,
  processDemoPayment,
} from '../lib/payments';
import type { OrderRecord, PaymentMethodId } from '../types/store';

export default function CheckoutPage() {
  const {
    user,
    cart,
    products,
    clearCart,
    addLocalOrder,
    refreshMyOrders,
    cartSubtotal,
  } = useStore();

  const [email, setEmail] = useState(user?.email ?? '');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    percentOff: number;
  } | null>(null);
  const [couponFeedback, setCouponFeedback] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodId>('demo-card');
  const [momoPhone, setMomoPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<OrderRecord | null>(
    null
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const enrichedCart = cart
    .map((c) => ({
      ...c,
      product: products.find((p) => p.id === c.productId),
    }))
    .filter((entry) => entry.product !== undefined);

  const discountAmount = appliedCoupon
    ? Number(((cartSubtotal * appliedCoupon.percentOff) / 100).toFixed(2))
    : 0;
  const total = Math.max(0, Number((cartSubtotal - discountAmount).toFixed(2)));
  const indicativeRwf = Math.round(total * 1360);

  const handleApplyCoupon = async () => {
    setCouponFeedback('');
    const code = couponInput.trim().toUpperCase();
    if (!code) return;

    try {
      const res = await fetch('/api/discounts/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as {
        valid: boolean;
        code?: string;
        percentOff?: number;
        error?: string;
      };
      if (!data.valid || !data.code || !data.percentOff) {
        setAppliedCoupon(null);
        setCouponFeedback(data.error || 'Invalid or inactive discount code.');
        return;
      }
      setAppliedCoupon({ code: data.code, percentOff: data.percentOff });
      setCouponFeedback(`Applied ${data.code} (${data.percentOff}% off).`);
    } catch {
      setCouponFeedback('Could not validate discount code.');
    }
  };

  const handlePlaceDemoOrder = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (enrichedCart.length === 0) return;

    setProcessing(true);
    let providerName = 'Free Access (Payments Coming Soon)';
    if (total > 0) {
      const payResult = await processDemoPayment({
        customerEmail: email.trim(),
        paymentMethod,
        momoPhone,
      });

      if (!payResult.success) {
        setProcessing(false);
        setError(payResult.error ?? 'Demo payment could not be completed.');
        return;
      }
      providerName = payResult.providerName;
    } else if (!email.trim().includes('@')) {
      setProcessing(false);
      setError('Please enter a valid email address for digital delivery.');
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (auth.currentUser) {
        headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerEmail: email.trim(),
          items: enrichedCart.map(({ product, qty }) => ({
            productId: product!.id,
            qty,
          })),
          discountCode: appliedCoupon?.code,
          paymentMethod,
          paymentProviderName: providerName,
        }),
      });

      const data = (await res.json()) as {
        order?: OrderRecord;
        error?: string;
      };

      if (!res.ok || !data.order) {
        setError(data.error || 'Could not record order on server.');
        setProcessing(false);
        return;
      }

      addLocalOrder(data.order);
      if (auth.currentUser) {
        void refreshMyOrders();
      }
      setConfirmedOrder(data.order);
      clearCart();
    } catch {
      setError('Network error saving demo order.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (productId: string) => {
    if (!confirmedOrder) return;
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    setDownloadingId(productId);
    const ok = await downloadVerifiedProductPackage(prod, confirmedOrder);
    setDownloadingId(null);
    if (!ok) {
      setError('Could not download this file. Please try again.');
    }
  };

  if (confirmedOrder) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-[#F3F1EA]">
        <div className="max-w-2xl mx-auto px-5">
          <div className="rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-8 md:p-10 space-y-6">
            <div className="flex items-center gap-3 text-[#23242B]">
              <CheckCircle2 className="w-7 h-7 text-[#E56B5D] shrink-0" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#E56B5D]">
                  {confirmedOrder.total === 0
                    ? 'Free eBook Access Confirmed'
                    : 'Order Confirmed · Backend Order Saved'}
                </p>
                <h1 className="font-serif-editorial font-medium text-2xl md:text-3xl text-[#23242B]">
                  Thank you — your downloads are ready
                </h1>
              </div>
            </div>

            <div className="rounded-xl bg-[#F3F1EA] border border-[#E5E2D8] p-4 text-xs text-[#6B6A64] space-y-1">
              <p>
                Order ID:{' '}
                <span className="font-mono-tabular font-bold text-[#23242B]">
                  {confirmedOrder.id}
                </span>
              </p>
              <p>Delivery Email: {confirmedOrder.customerEmail}</p>
              <p>Access Type: {confirmedOrder.paymentProviderName}</p>
              <p>
                Total:{' '}
                <span className="font-mono-tabular font-bold text-[#23242B]">
                  {confirmedOrder.total === 0
                    ? 'Free ($0.00)'
                    : `$${confirmedOrder.total.toFixed(2)} USD`}
                </span>{' '}
                (Online payments coming soon — free access)
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="font-serif-editorial font-medium text-lg text-[#23242B]">
                Secure Digital Delivery
              </h2>
              <p className="text-xs text-[#6B6A64]">
                Downloads are served through a verified backend endpoint gated by
                your order receipt and account session.
              </p>

              <div className="space-y-3 pt-2">
                {confirmedOrder.items.map((item) => {
                  const prod = products.find((p) => p.id === item.productId);
                  return (
                    <div
                      key={item.productId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-[#E5E2D8] bg-white"
                    >
                      <div>
                        <p className="font-semibold text-sm text-[#23242B]">
                          {item.title}
                        </p>
                        <p className="text-xs text-[#6B6A64]">
                          {prod?.hasUploadedFile && prod.deliverableFileName
                            ? `PDF / File: ${prod.deliverableFileName}`
                            : item.productType}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={downloadingId === item.productId}
                        onClick={() => void handleDownload(item.productId)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-xs font-semibold whitespace-nowrap shrink-0 btn-tactile cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {downloadingId === item.productId
                          ? 'Downloading...'
                          : prod?.hasUploadedFile
                          ? 'Download File'
                          : 'Download Starter Pack'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-[#E5E2D8] flex flex-wrap gap-3">
              <Link
                to="/account"
                className="px-5 py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold"
              >
                View Order History
              </Link>
              <Link
                to="/shop"
                className="px-5 py-2.5 rounded-full border border-[#E5E2D8] text-[#23242B] text-xs font-semibold"
              >
                Continue Exploring
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-24 pb-20 min-h-screen bg-[#F3F1EA]">
      <div className="max-w-[1200px] mx-auto px-5 md:px-10">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#E56B5D] mb-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Online Payments Coming Soon · Every eBook Is Currently Free</span>
          </div>
          <h1 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B]">
            Free Digital Checkout &amp; Download
          </h1>
        </div>

        {enrichedCart.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-12 text-center max-w-lg mx-auto">
            <ShoppingBag className="w-8 h-8 text-[#E56B5D] mx-auto mb-3" />
            <h2 className="font-serif-editorial font-medium text-2xl text-[#23242B]">
              Your cart is empty
            </h2>
            <p className="text-sm text-[#6B6A64] mt-2">
              Add SoloBiz OS or another digital tool to test demo checkout and
              server-gated PDF delivery.
            </p>
            <Link
              to="/shop"
              className="mt-6 inline-flex px-6 py-3 rounded-full bg-[#23242B] text-[#FAF9F5] text-sm font-semibold"
            >
              Browse Shop
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <form
              onSubmit={handlePlaceDemoOrder}
              className="lg:col-span-7 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 md:p-8 space-y-6"
            >
              <div>
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  1. Customer Delivery Email
                </h2>
                <p className="text-xs text-[#6B6A64] mt-1">
                  {user
                    ? `Signed in via Firebase Auth as ${user.email}.`
                    : 'Guest checkout supported, or sign in to link orders with your account.'}
                </p>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-3 w-full px-4 py-3 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
              </div>

              <div className="pt-5 border-t border-[#E5E2D8]">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  2. Payment Notice
                </h2>
                {total === 0 ? (
                  <div className="mt-3 rounded-xl border border-[#E56B5D]/35 bg-[#F3F1EA] p-4 text-xs text-[#23242B] leading-relaxed">
                    <p className="font-semibold text-[#E56B5D] mb-1">
                      Online payments are coming soon
                    </p>
                    <p className="text-[#6B6A64]">
                      Every eBook is free right now — no card or mobile money payment is needed. Complete below to unlock instant download.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-[#6B6A64] mt-1 leading-relaxed">
                      Online payment processing is coming soon. Test Mode is active below with no real charge.
                    </p>

                    <div className="mt-4 space-y-3">
                      {DEMO_PAYMENT_PROVIDERS.map((provider) => {
                        const selected = paymentMethod === provider.id;
                        return (
                          <label
                            key={provider.id}
                            className={`block rounded-xl border p-4 cursor-pointer transition-colors ${
                              selected
                                ? 'border-[#E56B5D] bg-[#F3F1EA]'
                                : 'border-[#E5E2D8] bg-white hover:border-[#CFCBC0]'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                name="paymentMethod"
                                checked={selected}
                                onChange={() => setPaymentMethod(provider.id)}
                                className="mt-1 accent-[#E56B5D]"
                              />
                              <div className="flex-1">
                                <p className="font-semibold text-sm text-[#23242B]">
                                  {provider.name}
                                </p>
                                <p className="text-xs text-[#E56B5D] font-medium mt-0.5">
                                  {provider.regionSupport}
                                </p>
                                <p className="text-xs text-[#6B6A64] mt-1">
                                  {provider.description}
                                </p>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {paymentMethod === 'demo-momo' && (
                      <div className="mt-4">
                        <label
                          htmlFor="momo-phone"
                          className="block text-xs font-medium text-[#6B6A64] mb-1"
                        >
                          Demo Mobile Money Number (Rwanda)
                        </label>
                        <input
                          id="momo-phone"
                          type="tel"
                          value={momoPhone}
                          onChange={(e) => setMomoPhone(e.target.value)}
                          placeholder="0780 000 000"
                          className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#E56B5D]/12 text-xs font-medium text-[#23242B]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={processing}
                className="w-full py-4 px-6 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] font-semibold text-sm inline-flex items-center justify-center gap-2 btn-tactile cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                {processing
                  ? 'Preparing Your Download...'
                  : total === 0
                  ? 'Get Free eBooks ($0.00)'
                  : `Complete Order ($${total.toFixed(2)} USD)`}
              </button>
            </form>

            <div className="lg:col-span-5 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 md:p-8 space-y-5">
              <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                Order Summary
              </h2>

              <div className="space-y-4">
                {enrichedCart.map(({ product, qty }) => (
                  <div
                    key={product!.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#23242B] truncate">
                        {product!.title}
                      </p>
                      <p className="text-xs text-[#6B6A64]">
                        Qty {qty} · {product!.price === 0 ? 'Free' : `$${product!.price} each`}
                      </p>
                    </div>
                    <span className="font-mono-tabular font-semibold text-[#23242B]">
                      {product!.price === 0
                        ? 'Free'
                        : `$${(product!.price * qty).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>

              {total > 0 && (
                <div className="pt-4 border-t border-[#E5E2D8]">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Discount code (e.g. WELCOME15)"
                      className="flex-1 px-3.5 py-2 rounded-full bg-white border border-[#E5E2D8] text-xs text-[#23242B] focus:outline-none focus:border-[#23242B]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleApplyCoupon()}
                      className="px-4 py-2 rounded-full border border-[#E5E2D8] bg-white text-xs font-semibold text-[#23242B] hover:bg-[#EAE6DA] cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                  {couponFeedback && (
                    <p className="text-xs text-[#E56B5D] mt-1.5 font-medium">
                      {couponFeedback}
                    </p>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E2D8] space-y-2 text-sm">
                <div className="flex justify-between text-[#6B6A64]">
                  <span>Subtotal</span>
                  <span className="font-mono-tabular">
                    {cartSubtotal === 0 ? 'Free' : `$${cartSubtotal.toFixed(2)}`}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-[#E56B5D]">
                    <span>Discount ({appliedCoupon?.code})</span>
                    <span className="font-mono-tabular">
                      -${discountAmount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-[#23242B] pt-2 border-t border-[#E5E2D8]">
                  <span>Total</span>
                  <span className="font-mono-tabular">
                    {total === 0 ? 'Free ($0.00)' : `$${total.toFixed(2)} USD`}
                  </span>
                </div>
                {total > 0 && (
                  <p className="text-[11px] text-[#6B6A64] text-right font-mono-tabular">
                    Indicative RWF equivalent: ~{indicativeRwf.toLocaleString()} RWF
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
