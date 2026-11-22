import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Image as ImageIcon,
  LayoutTemplate,
  Lock,
  LogOut,
  Mail,
  Package,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  auth,
  mapAuthError,
  sendUserVerificationEmail,
  signInWithEmail,
  signInWithGoogle,
} from '../lib/firebase';
import { CATEGORIES } from '../data/catalog';
import {
  DEFAULT_STOREFRONT_SETTINGS,
  broadcastStoreSync,
  useStore,
} from '../context/StoreContext';
import { safeMediaUrl } from '../lib/sanitize';
import type {
  CategoryId,
  ContactMessage,
  DiscountCode,
  NewsletterSubscriber,
  OrderRecord,
  Product,
  StorefrontSettings,
} from '../types/store';

type AdminTab =
  | 'overview'
  | 'products'
  | 'storefront'
  | 'orders'
  | 'journal';

interface AdminStatus {
  isAuthorized: boolean;
  ownerOnlyDenied?: boolean;
  envPassConfigured: boolean;
  hasClaimedAdmin: boolean;
  requiresSetup: boolean;
  emailVerified?: boolean;
  claimedEmail?: string;
}

interface AdminOverview {
  productCount: number;
  uploadedFileCount: number;
  orderCount: number;
  totalRevenue: number;
  subscriberCount: number;
  messageCount: number;
}

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildWeekStrip(anchorDate: Date) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const start = new Date(anchorDate);
  start.setDate(anchorDate.getDate() - anchorDate.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const today = new Date();
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    return {
      label: dayNames[i],
      dateNum: d.getDate(),
      iso: d.toISOString().slice(0, 10),
      isToday,
    };
  });
}

export default function AdminPage() {
  const {
    user,
    adminToken,
    setAdminToken,
    blogArticles,
    storefrontSettings,
    setStorefrontSettings,
    refreshCatalog,
    signOut,
  } = useStore();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [tab, setTab] = useState<AdminTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [inspectedProductId, setInspectedProductId] = useState<string>('');

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [adminOrders, setAdminOrders] = useState<OrderRecord[]>([]);
  const [adminSubscribers, setAdminSubscribers] = useState<
    NewsletterSubscriber[]
  >([]);
  const [adminMessages, setAdminMessages] = useState<ContactMessage[]>([]);
  const [adminDiscounts, setAdminDiscounts] = useState<DiscountCode[]>([]);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // Storefront Live Editor state
  const [sfForm, setSfForm] = useState<StorefrontSettings>(
    storefrontSettings || DEFAULT_STOREFRONT_SETTINGS
  );
  const [savingStorefront, setSavingStorefront] = useState(false);

  // Create Product Form
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newCategory, setNewCategory] = useState<CategoryId>(
    'business-entrepreneurship'
  );
  const [newPrice, setNewPrice] = useState('12');
  const [newType, setNewType] = useState('Digital PDF & Template');
  const [newDesc, setNewDesc] = useState('');
  const [newPreviewUrl, setNewPreviewUrl] = useState('');
  const [newPdfFile, setNewPdfFile] = useState<File | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);

  // Per-product upload busy tracking
  const [uploadingPdfId, setUploadingPdfId] = useState<string | null>(null);
  const [uploadingImgId, setUploadingImgId] = useState<string | null>(null);

  // Edit Product inline
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriceVal, setEditPriceVal] = useState('');

  // Blog Form
  const [blogTitle, setBlogTitle] = useState('');
  const [blogCategory, setBlogCategory] = useState('Small Business');
  const [blogExcerpt, setBlogExcerpt] = useState('');

  // Discount Form
  const [couponCode, setCouponCode] = useState('');
  const [couponPct, setCouponPct] = useState('20');

  const getAuthHeaders = useCallback(
    async (extra?: Record<string, string>) => {
      const headers: Record<string, string> = { ...extra };
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }
      if (adminToken) {
        headers['X-Admin-Token'] = adminToken;
      }
      if (!headers.Authorization && !headers['X-Admin-Token']) {
        throw new Error('Not signed in');
      }
      return headers;
    },
    [adminToken]
  );

  const handleAdminSignOut = useCallback(async () => {
    setAdminToken('');
    setStatus(null);
    await signOut();
  }, [setAdminToken, signOut]);

  const fetchAdminStatus = useCallback(async () => {
    if (!auth.currentUser && !adminToken) return;
    setStatusLoading(true);
    setAuthError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/status', { headers });
      if (res.ok) {
        const data = (await res.json()) as AdminStatus;
        setStatus(data);
      } else if (res.status === 401 && adminToken && !auth.currentUser) {
        setAdminToken('');
        setStatus(null);
      } else {
        setAuthError(`Backend status check failed (${res.status}).`);
      }
    } catch {
      setAuthError('Could not reach backend API (/api/admin/status).');
    } finally {
      setStatusLoading(false);
    }
  }, [adminToken, getAuthHeaders, setAdminToken]);

  const loadAdminWorkspaceData = useCallback(async () => {
    if (!auth.currentUser && !adminToken) return;
    try {
      const headers = await getAuthHeaders();
      const [ovRes, prodRes, ordRes, subRes, msgRes, discRes, sfRes] =
        await Promise.all([
          fetch('/api/admin/overview', { headers }),
          fetch('/api/admin/products', { headers }),
          fetch('/api/admin/orders', { headers }),
          fetch('/api/admin/subscribers', { headers }),
          fetch('/api/admin/messages', { headers }),
          fetch('/api/admin/discounts', { headers }),
          fetch('/api/admin/storefront', { headers }),
        ]);

      if (ovRes.ok) setOverview((await ovRes.json()) as AdminOverview);
      if (prodRes.ok) {
        const d = (await prodRes.json()) as { products: Product[] };
        setAdminProducts(d.products);
      }
      if (ordRes.ok) {
        const d = (await ordRes.json()) as { orders: OrderRecord[] };
        setAdminOrders(d.orders);
      }
      if (subRes.ok) {
        const d = (await subRes.json()) as {
          subscribers: NewsletterSubscriber[];
        };
        setAdminSubscribers(d.subscribers);
      }
      if (msgRes.ok) {
        const d = (await msgRes.json()) as { messages: ContactMessage[] };
        setAdminMessages(d.messages);
      }
      if (discRes.ok) {
        const d = (await discRes.json()) as { discountCodes: DiscountCode[] };
        setAdminDiscounts(d.discountCodes);
      }
      if (sfRes.ok) {
        const d = (await sfRes.json()) as {
          storefrontSettings: StorefrontSettings;
        };
        setSfForm(d.storefrontSettings);
        setStorefrontSettings(d.storefrontSettings);
      }
    } catch {
      setActionError('Failed to load admin workspace data.');
    }
  }, [adminToken, getAuthHeaders, setStorefrontSettings]);

  useEffect(() => {
    if (user || adminToken) {
      void fetchAdminStatus();
    } else {
      setStatus(null);
    }
  }, [user, adminToken, fetchAdminStatus]);

  useEffect(() => {
    if (status?.isAuthorized) {
      void loadAdminWorkspaceData();
    }
  }, [status?.isAuthorized, loadAdminWorkspaceData]);

  const handleStandaloneEmailSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });
      if (res.status === 429) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        setAuthError(
          errData.error || 'Too many failed sign-in attempts. Please wait and try again.'
        );
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { adminToken?: string };
        if (data.adminToken) {
          setAdminToken(data.adminToken);
          setLoginPassword('');
          setStatus({
            isAuthorized: true,
            ownerOnlyDenied: false,
            envPassConfigured: false,
            hasClaimedAdmin: true,
            requiresSetup: false,
            emailVerified: true,
          });
          return;
        }
      }

      await signInWithEmail(loginEmail, loginPassword);
      setLoginPassword('');
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleStandaloneGoogleSignIn = async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSendVerification = async () => {
    if (!auth.currentUser) return;
    setAuthError('');
    setAuthNotice('');
    setAuthBusy(true);
    try {
      await sendUserVerificationEmail(auth.currentUser);
      setAuthNotice('Verification link sent. Open it in your inbox, then click Check Verification.');
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (!auth.currentUser) return;
    setAuthError('');
    setAuthNotice('');
    setAuthBusy(true);
    try {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      await fetchAdminStatus();
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleClaimOrUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const endpoint = status?.requiresSetup
        ? '/api/admin/claim'
        : '/api/admin/unlock';
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = (await res.json()) as {
        adminToken?: string;
        error?: string;
      };
      if (!res.ok || !data.adminToken) {
        setAuthError(data.error || 'Could not authorize admin access.');
        return;
      }
      setAdminToken(data.adminToken);
      setPasswordInput('');
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              isAuthorized: true,
              requiresSetup: false,
              hasClaimedAdmin: true,
            }
          : {
              isAuthorized: true,
              envPassConfigured: false,
              hasClaimedAdmin: true,
              requiresSetup: false,
            }
      );
    } catch {
      setAuthError('Network error during admin verification.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveStorefront = async (e: FormEvent) => {
    e.preventDefault();
    setActionError('');
    setActionNotice('');
    setSavingStorefront(true);
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch('/api/admin/storefront', {
        method: 'PUT',
        headers,
        body: JSON.stringify(sfForm),
      });
      const data = (await res.json()) as {
        storefrontSettings?: StorefrontSettings;
        error?: string;
      };
      if (!res.ok || !data.storefrontSettings) {
        setActionError(data.error || 'Could not update storefront settings.');
        return;
      }
      setSfForm(data.storefrontSettings);
      setStorefrontSettings(data.storefrontSettings);
      await refreshCatalog();
      broadcastStoreSync();
      setActionNotice(
        'Customer webstore headline, copy, and spotlight updated live.'
      );
    } catch {
      setActionError('Network error updating storefront.');
    } finally {
      setSavingStorefront(false);
    }
  };

  const handleUploadPreviewForNew = async (file: File) => {
    setActionError('');
    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/admin/upload/preview', {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setActionError(data.error || 'Preview upload failed.');
        return;
      }
      setNewPreviewUrl(data.url);
      setActionNotice('Preview image uploaded.');
    } catch {
      setActionError('Preview image upload error.');
    }
  };

  const handleCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setActionError('');
    setActionNotice('');
    setCreatingProduct(true);

    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: newTitle.trim(),
          subtitle: newSubtitle.trim() || newDesc.trim(),
          category: newCategory,
          productType: newType.trim(),
          shortDesc: newDesc.trim(),
          fullDesc: newDesc.trim(),
          price: Number(newPrice) || 0,
          image: newPreviewUrl || undefined,
          fileFormats: newPdfFile ? ['PDF'] : ['Digital Package'],
        }),
      });
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok || !data.product) {
        setActionError(data.error || 'Could not create product.');
        setCreatingProduct(false);
        return;
      }

      if (newPdfFile) {
        const uploadHeaders = await getAuthHeaders();
        const fd = new FormData();
        fd.append('file', newPdfFile);
        const upRes = await fetch(
          `/api/admin/products/${encodeURIComponent(data.product.id)}/deliverable`,
          { method: 'POST', headers: uploadHeaders, body: fd }
        );
        if (!upRes.ok) {
          const upErr = (await upRes.json()) as { error?: string };
          setActionError(
            upErr.error || 'Product created, but PDF upload failed.'
          );
        }
      }

      setNewTitle('');
      setNewSubtitle('');
      setNewDesc('');
      setNewPreviewUrl('');
      setNewPdfFile(null);
      setActionNotice('Product saved to backend and published to Customer Store.');
      await Promise.all([loadAdminWorkspaceData(), refreshCatalog()]);
      broadcastStoreSync();
    } catch {
      setActionError('Network error creating product.');
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleUploadProductPdf = async (productId: string, file: File) => {
    setActionError('');
    setActionNotice('');
    setUploadingPdfId(productId);
    try {
      const headers = await getAuthHeaders();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/deliverable`,
        {
          method: 'POST',
          headers,
          body: fd,
        }
      );
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok) {
        setActionError(data.error || 'Could not upload PDF deliverable.');
        return;
      }
      setActionNotice(
        `Attached "${data.product?.deliverableFileName || file.name}" to product.`
      );
      await Promise.all([loadAdminWorkspaceData(), refreshCatalog()]);
      broadcastStoreSync();
    } catch {
      setActionError('Failed uploading deliverable file.');
    } finally {
      setUploadingPdfId(null);
    }
  };

  const handleReplaceProductImage = async (productId: string, file: File) => {
    setActionError('');
    setActionNotice('');
    setUploadingImgId(productId);
    try {
      const uploadHeaders = await getAuthHeaders();
      const fd = new FormData();
      fd.append('image', file);
      const upRes = await fetch('/api/admin/upload/preview', {
        method: 'POST',
        headers: uploadHeaders,
        body: fd,
      });
      const upData = (await upRes.json()) as { url?: string; error?: string };
      if (!upRes.ok || !upData.url) {
        setActionError(upData.error || 'Preview upload failed.');
        return;
      }

      const jsonHeaders = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ image: upData.url }),
      });

      setActionNotice('Product cover image updated live.');
      await Promise.all([loadAdminWorkspaceData(), refreshCatalog()]);
      broadcastStoreSync();
    } catch {
      setActionError('Failed updating product preview image.');
    } finally {
      setUploadingImgId(null);
    }
  };

  const handleUpdateProduct = async (
    productId: string,
    patch: Partial<{
      title: string;
      subtitle: string;
      shortDesc: string;
      fullDesc: string;
      price: number;
      featured: boolean;
    }>
  ) => {
    setActionError('');
    setActionNotice('');
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(patch),
        }
      );
      if (res.ok) {
        setEditingProductId(null);
        setActionNotice('Product changes synced to Customer Store.');
        await Promise.all([loadAdminWorkspaceData(), refreshCatalog()]);
        broadcastStoreSync();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(d.error || 'Could not update product.');
      }
    } catch {
      setActionError('Could not update product.');
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    setActionError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}`,
        {
          method: 'DELETE',
          headers,
        }
      );
      if (res.ok) {
        setActionNotice('Product removed from catalog.');
        await Promise.all([loadAdminWorkspaceData(), refreshCatalog()]);
        broadcastStoreSync();
      }
    } catch {
      setActionError('Failed to delete product.');
    }
  };

  const handleAddBlog = async (e: FormEvent) => {
    e.preventDefault();
    if (!blogTitle.trim()) return;
    setActionError('');
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch('/api/admin/blog', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: blogTitle.trim(),
          category: blogCategory,
          excerpt: blogExcerpt.trim(),
        }),
      });
      if (res.ok) {
        setBlogTitle('');
        setBlogExcerpt('');
        setActionNotice('Editorial article published to Customer Store.');
        await refreshCatalog();
        broadcastStoreSync();
      }
    } catch {
      setActionError('Failed publishing article.');
    }
  };

  const handleDeleteBlog = async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/blog/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await refreshCatalog();
        broadcastStoreSync();
      }
    } catch {
      setActionError('Failed deleting article.');
    }
  };

  const handleAddCoupon = async (e: FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: couponCode.trim(),
          percentOff: Number(couponPct) || 10,
        }),
      });
      if (res.ok) {
        setCouponCode('');
        await loadAdminWorkspaceData();
        setActionNotice('Discount code active in Checkout.');
      }
    } catch {
      setActionError('Failed creating discount code.');
    }
  };

  const handleToggleCoupon = async (code: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/admin/discounts/${encodeURIComponent(code)}/toggle`,
        { method: 'PATCH', headers }
      );
      if (res.ok) await loadAdminWorkspaceData();
    } catch {
      setActionError('Failed updating discount code.');
    }
  };

  const weekDays = useMemo(() => {
    const anchor = new Date();
    anchor.setDate(anchor.getDate() + weekOffset * 7);
    return buildWeekStrip(anchor);
  }, [weekOffset]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return adminProducts;
    return adminProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.productType.toLowerCase().includes(q) ||
        p.shortDesc.toLowerCase().includes(q)
    );
  }, [adminProducts, searchQuery]);

  const spotlightProduct =
    adminProducts.find((p) => p.id === inspectedProductId) ||
    adminProducts.find((p) => p.id === sfForm.spotlightProductId) ||
    adminProducts[0];

  const activityFeed = useMemo(() => {
    const events: {
      id: string;
      author: string;
      note: string;
      meta: string;
      time: string;
      accent: string;
    }[] = [];

    for (const o of adminOrders.slice(0, 3)) {
      events.push({
        id: `ord-${o.id}`,
        author: o.customerEmail,
        note: `Order for ${o.items.map((i) => i.title).join(', ')}`,
        meta: `$${o.total.toFixed(2)} USD · ${o.status}`,
        time: new Date(o.createdAt).toLocaleDateString(),
        accent: '#E56B5D',
      });
    }

    for (const m of adminMessages.slice(0, 2)) {
      events.push({
        id: `msg-${m.id}`,
        author: m.name,
        note: m.message,
        meta: `Inbox · ${m.email}`,
        time: new Date(m.created_at).toLocaleDateString(),
        accent: '#23242B',
      });
    }

    for (const s of adminSubscribers.slice(0, 2)) {
      events.push({
        id: `sub-${s.id}`,
        author: s.firstName || s.email,
        note: s.resourceName
          ? `Downloaded ${s.resourceName}`
          : 'Joined CraftedLabs dispatch',
        meta: s.source,
        time: new Date(s.createdAt).toLocaleDateString(),
        accent: '#6B6A64',
      });
    }

    return events.slice(0, 5);
  }, [adminOrders, adminMessages, adminSubscribers]);

  // Standalone Admin Gate States (strictly separated from Customer Web)
  if (!user && !adminToken) {
    return (
      <div className="min-h-screen bg-[#F3F1EA] flex items-center justify-center px-5 py-16">
        <div className="max-w-md w-full rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-8 md:p-10 space-y-5 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-[#E56B5D]/12 text-[#E56B5D] flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="font-serif-editorial font-bold text-3xl text-[#23242B] text-center">
            Admin Sign In
          </h1>

          <form onSubmit={handleStandaloneEmailSignIn} className="space-y-3.5">
            <div>
              <label
                htmlFor="admin-login-email"
                className="block text-xs font-medium text-[#6B6A64] mb-1"
              >
                Email
              </label>
              <input
                id="admin-login-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-login-password"
                className="block text-xs font-medium text-[#6B6A64] mb-1"
              >
                Password
              </label>
              <input
                id="admin-login-password"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
              />
            </div>

            {authError && (
              <p className="p-3 rounded-xl bg-[#E56B5D]/12 text-xs font-medium text-[#23242B]">
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-sm font-semibold cursor-pointer"
            >
              {authBusy ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs text-[#6B6A64]">
            <div className="h-px flex-1 bg-[#E5E2D8]" />
            <span>or</span>
            <div className="h-px flex-1 bg-[#E5E2D8]" />
          </div>

          <button
            type="button"
            disabled={authBusy}
            onClick={() => void handleStandaloneGoogleSignIn()}
            className="w-full py-3 rounded-full border border-[#E5E2D8] bg-white hover:bg-[#EAE6DA] disabled:opacity-60 text-sm font-semibold text-[#23242B] cursor-pointer"
          >
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  if (statusLoading) {
    return (
      <div className="min-h-screen bg-[#F3F1EA] flex items-center justify-center">
        <p className="text-sm font-medium text-[#6B6A64]">
          Verifying access...
        </p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-[#F3F1EA] flex items-center justify-center px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-8 text-center space-y-4">
          <ShieldAlert className="w-8 h-8 text-[#E56B5D] mx-auto" />
          <h1 className="font-serif-editorial font-bold text-2xl text-[#23242B]">
            Backend Connection Needed
          </h1>
          <p className="text-sm text-[#6B6A64]">
            {authError || 'Could not reach the backend API.'}
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => void fetchAdminStatus()}
              className="px-6 py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              type="button"
              onClick={() => void handleAdminSignOut()}
              className="text-xs font-medium text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.ownerOnlyDenied) {
    return (
      <div className="min-h-screen bg-[#F3F1EA] flex items-center justify-center px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-8 text-center space-y-4">
          <Lock className="w-8 h-8 text-[#E56B5D] mx-auto" />
          <h1 className="font-serif-editorial font-bold text-2xl text-[#23242B]">
            Restricted Access
          </h1>
          <p className="text-sm text-[#6B6A64] leading-relaxed">
            This workspace is restricted. Please sign in with an authorized
            account.
          </p>
          <button
            type="button"
            onClick={() => void handleAdminSignOut()}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Switch Account
          </button>
        </div>
      </div>
    );
  }

  if (!status.isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F3F1EA] flex items-center justify-center px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-8 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#E56B5D]">
              <ShieldAlert className="w-5 h-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                {status.requiresSetup ? 'Initial Setup' : 'Studio Unlock'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleAdminSignOut()}
              className="text-xs font-medium text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
            >
              Sign out
            </button>
          </div>
          <h1 className="font-serif-editorial font-bold text-2xl text-[#23242B]">
            {status.requiresSetup ? 'Set Studio Passcode' : 'Unlock Studio'}
          </h1>
          <form onSubmit={handleClaimOrUnlock} className="space-y-3">
            <input
              type="password"
              required
              minLength={status.requiresSetup ? 8 : 1}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={
                status.requiresSetup
                  ? 'Create passcode (8+ chars)'
                  : 'Enter studio passcode'
              }
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm focus:outline-none focus:border-[#23242B]"
            />
            {authError && <p className="text-xs text-[#E56B5D]">{authError}</p>}
            {authNotice && (
              <p className="text-xs text-[#23242B] bg-[#EAE6DA] p-2.5 rounded-xl">
                {authNotice}
              </p>
            )}
            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-sm font-semibold cursor-pointer"
            >
              {authBusy
                ? 'Verifying...'
                : status.requiresSetup
                ? 'Set Passcode & Enter'
                : 'Enter Studio'}
            </button>
          </form>

          {!status.envPassConfigured && status.emailVerified === false && (
            <div className="pt-4 border-t border-[#E5E2D8] space-y-2.5">
              <p className="text-xs text-[#6B6A64] leading-relaxed">
                Verify your email once to skip the studio passcode on future email sign-ins.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleSendVerification()}
                  className="px-4 py-2 rounded-full border border-[#E5E2D8] bg-white hover:bg-[#EAE6DA] text-xs font-semibold text-[#23242B] cursor-pointer"
                >
                  Send Verification Email
                </button>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleRefreshVerification()}
                  className="px-4 py-2 rounded-full bg-[#EAE6DA] hover:bg-[#E5E2D8] text-xs font-semibold text-[#23242B] cursor-pointer"
                >
                  Check Verification
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const navItems: {
    id: AdminTab;
    label: string;
    icon: typeof Home;
  }[] = [
    { id: 'overview', label: 'Studio', icon: Home },
    { id: 'products', label: 'Catalog & PDFs', icon: Package },
    { id: 'storefront', label: 'Live Webstore', icon: LayoutTemplate },
    { id: 'orders', label: 'Orders & Leads', icon: Users },
    { id: 'journal', label: 'Journal & Offers', icon: BookOpen },
  ];

  const uploadedRatioCount = overview?.uploadedFileCount ?? adminProducts.filter((p) => p.hasUploadedFile).length;

  return (
    <div className="min-h-screen bg-[#F3F1EA] text-[#23242B] flex flex-col lg:flex-row">
      {/* COLUMN 1: NARROW STUDIO ICON RAIL */}
      <aside className="lg:w-[76px] shrink-0 bg-[#FAF9F5] border-b lg:border-b-0 lg:border-r border-[#E5E2D8] flex lg:flex-col items-center justify-between px-4 py-3 lg:py-6 gap-4 sticky top-0 z-40 lg:h-screen">
        <div
          aria-label="Store Studio"
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-[#23242B] shrink-0"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="22"
              height="22"
              rx="6"
              stroke="currentColor"
              strokeWidth="2.1"
            />
            <path
              d="M9 18L14 9L19 18H9Z"
              fill="#E56B5D"
              fillOpacity="0.28"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <nav
          className="flex lg:flex-col items-center gap-2 overflow-x-auto"
          aria-label="Store Studio Navigation"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                title={item.label}
                aria-label={item.label}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#E56B5D] text-[#FAF9F5] shadow-sm'
                    : 'text-[#6B6A64] hover:text-[#23242B] hover:bg-[#EAE6DA]/70'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            );
          })}
        </nav>

        <div className="flex lg:flex-col items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleAdminSignOut()}
            title="Sign out"
            aria-label="Sign out"
            className="w-10 h-10 rounded-xl border border-[#E5E2D8] flex items-center justify-center text-[#6B6A64] hover:text-[#E56B5D] hover:bg-[#EAE6DA]/70 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* COLUMN 2: CENTRAL EDITORIAL STUDIO WORKSPACE */}
      <div className="flex-1 min-w-0 px-5 md:px-10 py-6 lg:py-8 space-y-8 overflow-y-auto">
        {/* Top Search & Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#6B6A64] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product, PDF deliverable, order, or post..."
              className="w-full pl-10 pr-4 py-2 rounded-full bg-transparent hover:bg-[#FAF9F5]/80 focus:bg-[#FAF9F5] border border-transparent focus:border-[#E5E2D8] text-sm text-[#23242B] placeholder:text-[#6B6A64] focus:outline-none transition-colors"
            />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setTab('storefront')}
              className="px-4 py-2 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-[#EAE6DA] font-medium text-[#23242B] cursor-pointer"
            >
              Edit Storefront Copy
            </button>
          </div>
        </div>

        {/* Status Toast Notices */}
        {actionNotice && (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] px-4 py-3 text-xs font-medium text-[#23242B] flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#E56B5D] shrink-0" />
              {actionNotice}
            </span>
            <button
              type="button"
              onClick={() => setActionNotice('')}
              className="text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
        {actionError && (
          <div className="rounded-2xl bg-[#E56B5D]/12 border border-[#E56B5D]/35 px-4 py-3 text-xs font-semibold text-[#23242B] flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError('')}
              className="text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: STUDIO OVERVIEW */}
        {tab === 'overview' && (
          <div className="space-y-10">
            {/* Editorial Workspace Header + Dark Pill CTA */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-4 max-w-lg">
                <h1 className="font-serif-editorial font-medium text-4xl sm:text-[2.85rem] leading-[1.08] tracking-tight text-[#23242B]">
                  Store Studio
                </h1>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setTab('products')}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-medium btn-tactile cursor-pointer"
                  >
                    Manage catalog
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('storefront')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-[#EAE6DA] text-xs font-semibold text-[#23242B] cursor-pointer"
                  >
                    Customize Storefront
                  </button>
                </div>
              </div>

              {/* Clean Studio Metric Pair */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 shrink-0">
                <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-4 min-w-[120px]">
                  <p className="text-xs text-[#6B6A64]">Products</p>
                  <p className="font-mono-tabular font-bold text-2xl text-[#23242B] mt-1">
                    {overview?.productCount ?? adminProducts.length}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-4 min-w-[120px]">
                  <p className="text-xs text-[#6B6A64]">PDFs Uploaded</p>
                  <p className="font-mono-tabular font-bold text-2xl text-[#E56B5D] mt-1">
                    {uploadedRatioCount}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-4 min-w-[120px]">
                  <p className="text-xs text-[#6B6A64]">Orders</p>
                  <p className="font-mono-tabular font-bold text-2xl text-[#23242B] mt-1">
                    {overview?.orderCount ?? adminOrders.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Catalog Now — 4-Card Editorial Cover Shelf */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Catalog Now
                </h2>
                <button
                  type="button"
                  onClick={() => setTab('products')}
                  className="text-xs font-medium text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
                >
                  View all {adminProducts.length} →
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                {filteredProducts.slice(0, 4).map((prod) => {
                  const selected = spotlightProduct?.id === prod.id;
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => setInspectedProductId(prod.id)}
                      className="text-left group cursor-pointer focus:outline-none"
                    >
                      <div
                        className={`aspect-[3/4] rounded-xl overflow-hidden bg-[#FAF9F5] border transition-all shadow-[0_14px_28px_rgba(35,36,43,0.10)] group-hover:-translate-y-1 ${
                          selected
                            ? 'border-[#E56B5D] ring-2 ring-[#E56B5D]/25'
                            : 'border-[#E5E2D8]'
                        }`}
                      >
                        <img
                          src={safeMediaUrl(prod.image)}
                          alt={prod.imageAlt}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="mt-3 font-medium text-sm text-[#23242B] leading-snug line-clamp-1 group-hover:text-[#E56B5D] transition-colors">
                        {prod.title}
                      </p>
                      <p className="text-xs text-[#6B6A64] mt-0.5 font-mono-tabular">
                        ${prod.price} USD ·{' '}
                        {prod.hasUploadedFile ? 'PDF ready' : 'Starter pack'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Live Storefront Banner Row */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Live Customer Storefront Control
                </h2>
                <button
                  type="button"
                  onClick={() => setTab('storefront')}
                  className="text-xs font-semibold text-[#E56B5D] hover:underline cursor-pointer"
                >
                  Edit copy &amp; hero →
                </button>
              </div>

              <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium text-[#E56B5D]">
                    {sfForm.heroEyebrow}
                  </p>
                  <p className="font-serif-editorial font-medium text-lg text-[#23242B] truncate">
                    {sfForm.heroHeadline}
                  </p>
                  <p className="text-xs text-[#6B6A64] line-clamp-1">
                    Ticker: {sfForm.announcementText}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('storefront')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Editor
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: CATALOG & PDF DELIVERABLES */}
        {tab === 'products' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-7 items-start">
            {/* Create Product + Upload PDF Form */}
            <form
              onSubmit={handleCreateProduct}
              className="xl:col-span-5 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-4"
            >
              <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                Add Product &amp; Upload PDF
              </h2>

              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Product title"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm focus:outline-none focus:border-[#23242B]"
              />
              <input
                type="text"
                value={newSubtitle}
                onChange={(e) => setNewSubtitle(e.target.value)}
                placeholder="Short tagline / subtitle"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm focus:outline-none focus:border-[#23242B]"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CategoryId)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm focus:outline-none focus:border-[#23242B]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="Price (USD)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm font-mono-tabular"
                />
                <input
                  type="text"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="Type (e.g. PDF Guide)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>
              <textarea
                rows={3}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Product description shown to customers"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
              />

              {/* Preview Image Upload */}
              <div className="p-3.5 rounded-xl bg-[#F3F1EA] border border-[#E5E2D8] space-y-2">
                <p className="text-xs font-semibold text-[#23242B] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[#E56B5D]" />
                  Cover / Preview Image (JPG, PNG, WEBP)
                </p>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadPreviewForNew(f);
                  }}
                  className="block w-full text-xs text-[#6B6A64]"
                />
                {newPreviewUrl && (
                  <p className="text-[11px] text-[#E56B5D] font-medium truncate">
                    Uploaded: {newPreviewUrl}
                  </p>
                )}
              </div>

              {/* Private PDF / Deliverable Upload */}
              <div className="p-3.5 rounded-xl bg-[#E56B5D]/8 border border-[#E56B5D]/30 space-y-2">
                <p className="text-xs font-semibold text-[#23242B] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#E56B5D]" />
                  Private Deliverable File (PDF / XLSX / ZIP)
                </p>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.md,.txt,.zip"
                  onChange={(e) => setNewPdfFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-[#6B6A64]"
                />
                {newPdfFile && (
                  <p className="text-[11px] text-[#23242B] font-medium">
                    Ready: {newPdfFile.name} ({formatBytes(newPdfFile.size)})
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={creatingProduct}
                className="w-full py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {creatingProduct
                  ? 'Publishing Product...'
                  : 'Save & Publish to Customer Store'}
              </button>
            </form>

            {/* Product List + Direct PDF Uploader per Product */}
            <div className="xl:col-span-7 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Live Catalog &amp; PDF Files ({filteredProducts.length})
                </h2>
              </div>

              <div className="space-y-4">
                {filteredProducts.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-[#E5E2D8] bg-white space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={safeMediaUrl(p.image)}
                          alt={p.imageAlt}
                          className="w-14 h-16 rounded-lg object-cover border border-[#E5E2D8] shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[#23242B] truncate">
                            {p.title}
                          </p>
                          <p className="text-xs text-[#6B6A64] truncate font-mono-tabular">
                            ${p.price} USD · {p.productType}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (editingProductId === p.id) {
                              setEditingProductId(null);
                            } else {
                              setEditingProductId(p.id);
                              setEditTitle(p.title);
                              setEditSubtitle(p.subtitle);
                              setEditDesc(p.shortDesc);
                              setEditPriceVal(String(p.price));
                            }
                          }}
                          className="px-3 py-1.5 rounded-full border border-[#E5E2D8] text-xs font-medium cursor-pointer hover:bg-[#F3F1EA]"
                        >
                          {editingProductId === p.id ? 'Close' : 'Edit'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdateProduct(p.id, {
                              featured: !p.featured,
                            })
                          }
                          className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${
                            p.featured
                              ? 'bg-[#23242B] text-[#FAF9F5]'
                              : 'border border-[#E5E2D8] text-[#6B6A64]'
                          }`}
                        >
                          {p.featured ? 'Featured' : 'Feature'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteProduct(p.id)}
                          aria-label={`Delete ${p.title}`}
                          className="p-1.5 text-[#6B6A64] hover:text-[#E56B5D] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {editingProductId === p.id && (
                      <div className="p-4 rounded-xl bg-[#F3F1EA] border border-[#E5E2D8] space-y-3 text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                            className="sm:col-span-2 px-3 py-2 rounded-lg bg-white border border-[#E5E2D8]"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={editPriceVal}
                            onChange={(e) => setEditPriceVal(e.target.value)}
                            placeholder="Price USD"
                            className="px-3 py-2 rounded-lg bg-white border border-[#E5E2D8] font-mono-tabular"
                          />
                        </div>
                        <input
                          type="text"
                          value={editSubtitle}
                          onChange={(e) => setEditSubtitle(e.target.value)}
                          placeholder="Subtitle"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E2D8]"
                        />
                        <textarea
                          rows={2}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Short & full description"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E2D8]"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingProductId(null)}
                            className="px-4 py-1.5 rounded-full border border-[#E5E2D8] bg-white font-medium cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleUpdateProduct(p.id, {
                                title: editTitle.trim(),
                                subtitle: editSubtitle.trim(),
                                shortDesc: editDesc.trim(),
                                fullDesc: editDesc.trim(),
                                price: Math.max(0, Number(editPriceVal) || 0),
                              })
                            }
                            className="px-5 py-1.5 rounded-full bg-[#23242B] text-[#FAF9F5] font-semibold cursor-pointer"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* PDF Deliverable & Cover Upload Bar */}
                    <div className="pt-3 border-t border-[#E5E2D8] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-[#6B6A64] min-w-0">
                        <FileText className="w-4 h-4 text-[#E56B5D] shrink-0" />
                        {p.hasUploadedFile ? (
                          <span className="truncate font-medium text-[#23242B]">
                            Attached: {p.deliverableFileName} (
                            {formatBytes(p.deliverableFileSize)})
                          </span>
                        ) : (
                          <span className="truncate">
                            No PDF uploaded yet (uses starter guide)
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] font-semibold cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {uploadingPdfId === p.id
                              ? 'Uploading...'
                              : p.hasUploadedFile
                              ? 'Replace PDF'
                              : 'Upload PDF'}
                          </span>
                          <input
                            type="file"
                            accept=".pdf,.xlsx,.xls,.csv,.md,.txt,.zip"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleUploadProductPdf(p.id, file);
                              e.target.value = '';
                            }}
                          />
                        </label>

                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E5E2D8] hover:bg-[#F3F1EA] text-[#23242B] font-medium cursor-pointer">
                          <ImageIcon className="w-3.5 h-3.5 text-[#6B6A64]" />
                          <span>
                            {uploadingImgId === p.id ? 'Uploading...' : 'Cover Img'}
                          </span>
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleReplaceProductImage(p.id, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LIVE CUSTOMER STOREFRONT DESIGN & COPY */}
        {tab === 'storefront' && (
          <form
            onSubmit={handleSaveStorefront}
            className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 md:p-8 space-y-6 max-w-4xl"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E5E2D8]">
              <div>
                <h2 className="font-serif-editorial font-medium text-2xl text-[#23242B]">
                  Live Webstore Copy &amp; Spotlight
                </h2>
                <p className="text-xs text-[#6B6A64] mt-1">
                  Updates homepage hero, ticker, and spotlight selection.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Store Name
                </label>
                <input
                  type="text"
                  value={sfForm.storeName}
                  onChange={(e) =>
                    setSfForm((prev) => ({ ...prev, storeName: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Brand Tagline
                </label>
                <input
                  type="text"
                  value={sfForm.tagline}
                  onChange={(e) =>
                    setSfForm((prev) => ({ ...prev, tagline: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Hero Eyebrow Label
                </label>
                <input
                  type="text"
                  value={sfForm.heroEyebrow}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      heroEyebrow: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Primary Hero CTA Button Text
                </label>
                <input
                  type="text"
                  value={sfForm.heroCtaText}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      heroCtaText: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                Hero Headline
              </label>
              <input
                type="text"
                value={sfForm.heroHeadline}
                onChange={(e) =>
                  setSfForm((prev) => ({
                    ...prev,
                    heroHeadline: e.target.value,
                  }))
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-base font-serif-editorial"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                Hero Subtitle
              </label>
              <textarea
                rows={3}
                value={sfForm.heroSubtitle}
                onChange={(e) =>
                  setSfForm((prev) => ({
                    ...prev,
                    heroSubtitle: e.target.value,
                  }))
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Announcement Strip Text
                </label>
                <input
                  type="text"
                  value={sfForm.announcementText}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      announcementText: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Spotlight Hero Product
                </label>
                <select
                  value={sfForm.spotlightProductId}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      spotlightProductId: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                >
                  {adminProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} (${p.price} USD)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E5E2D8] space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Brand Story Heading
                </label>
                <input
                  type="text"
                  value={sfForm.storyTitle}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      storyTitle: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#23242B] mb-1.5">
                  Brand Story Copy
                </label>
                <textarea
                  rows={3}
                  value={sfForm.storyBody}
                  onChange={(e) =>
                    setSfForm((prev) => ({
                      ...prev,
                      storyBody: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <p className="text-xs text-[#6B6A64]">
                {sfForm.updatedAt
                  ? `Last synced: ${new Date(sfForm.updatedAt).toLocaleString()}`
                  : 'Ready to publish updates'}
              </p>
              <button
                type="submit"
                disabled={savingStorefront}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-sm font-semibold btn-tactile cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#E56B5D]" />
                {savingStorefront
                  ? 'Publishing...'
                  : 'Publish Live to Customer Store'}
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: ORDERS, SUBSCRIBERS & INBOX */}
        {tab === 'orders' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
              <h2 className="font-serif-editorial font-medium text-xl text-[#23242B] mb-4">
                Orders ({adminOrders.length})
              </h2>
              {adminOrders.length === 0 ? (
                <p className="text-sm text-[#6B6A64]">No orders placed yet.</p>
              ) : (
                <div className="space-y-3">
                  {adminOrders.map((o) => (
                    <div
                      key={o.id}
                      className="p-4 rounded-xl border border-[#E5E2D8] bg-white flex flex-wrap justify-between gap-3 text-sm"
                    >
                      <div>
                        <p className="font-mono-tabular font-bold text-[#23242B]">
                          {o.id} · {o.customerEmail}
                        </p>
                        <p className="text-xs text-[#6B6A64] mt-1">
                          {o.items.map((i) => `${i.title} (x${i.qty})`).join(', ')} ·{' '}
                          Downloads: {o.downloadCount}
                        </p>
                      </div>
                      <span className="font-mono-tabular font-bold text-[#E56B5D]">
                        ${o.total.toFixed(2)} USD
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
                <h3 className="font-serif-editorial font-medium text-lg text-[#23242B] mb-3">
                  Subscribers &amp; Free Resource Leads ({adminSubscribers.length})
                </h3>
                {adminSubscribers.length === 0 ? (
                  <p className="text-xs text-[#6B6A64]">No subscribers yet.</p>
                ) : (
                  <div className="space-y-2">
                    {adminSubscribers.map((s) => (
                      <div
                        key={s.id}
                        className="p-3 rounded-xl border border-[#E5E2D8] bg-white flex justify-between gap-2 text-xs"
                      >
                        <span className="font-medium text-[#23242B] truncate">
                          {s.firstName ? `${s.firstName} · ` : ''}
                          {s.email}
                        </span>
                        <span className="text-[#6B6A64] shrink-0">
                          {s.source}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
                <h3 className="font-serif-editorial font-medium text-lg text-[#23242B] mb-3 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[#E56B5D]" />
                  Contact Messages ({adminMessages.length})
                </h3>
                {adminMessages.length === 0 ? (
                  <p className="text-xs text-[#6B6A64]">
                    No customer messages yet.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {adminMessages.map((m) => (
                      <div
                        key={m.id}
                        className="p-3.5 rounded-xl border border-[#E5E2D8] bg-white space-y-1 text-xs"
                      >
                        <div className="flex justify-between">
                          <span className="font-semibold text-[#23242B]">
                            {m.name} ({m.email})
                          </span>
                          <span className="text-[#6B6A64]">
                            {new Date(m.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-[#6B6A64]">{m.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: EDITORIAL JOURNAL & DISCOUNT CODES */}
        {tab === 'journal' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={handleAddBlog}
                className="lg:col-span-5 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-4"
              >
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Publish Journal Article
                </h2>
                <input
                  type="text"
                  required
                  value={blogTitle}
                  onChange={(e) => setBlogTitle(e.target.value)}
                  placeholder="Article title"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
                <input
                  type="text"
                  value={blogCategory}
                  onChange={(e) => setBlogCategory(e.target.value)}
                  placeholder="Category"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
                <textarea
                  rows={4}
                  value={blogExcerpt}
                  onChange={(e) => setBlogExcerpt(e.target.value)}
                  placeholder="Article summary & opening paragraph"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold cursor-pointer"
                >
                  Publish to Storefront Journal
                </button>
              </form>

              <div className="lg:col-span-7 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-3">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Published Articles ({blogArticles.length})
                </h2>
                {blogArticles.map((art) => (
                  <div
                    key={art.id}
                    className="p-3.5 rounded-xl border border-[#E5E2D8] bg-white flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[#23242B] truncate">
                        {art.title}
                      </p>
                      <p className="text-xs text-[#6B6A64]">
                        {art.category} · {art.publishedAt}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteBlog(art.id)}
                      aria-label={`Delete ${art.title}`}
                      className="p-1.5 text-[#6B6A64] hover:text-[#E56B5D] cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={handleAddCoupon}
                className="lg:col-span-5 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-4"
              >
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B] flex items-center gap-2">
                  <Tag className="w-4 h-4 text-[#E56B5D]" />
                  Create Discount Code
                </h2>
                <input
                  type="text"
                  required
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Code (e.g. LAUNCH20)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm uppercase"
                />
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={couponPct}
                  onChange={(e) => setCouponPct(e.target.value)}
                  placeholder="Percent off"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm font-mono-tabular"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold cursor-pointer"
                >
                  Save Discount Code
                </button>
              </form>

              <div className="lg:col-span-7 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 space-y-3">
                <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                  Active Checkout Codes ({adminDiscounts.length})
                </h2>
                {adminDiscounts.map((d) => (
                  <div
                    key={d.code}
                    className="p-3.5 rounded-xl border border-[#E5E2D8] bg-white flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-mono-tabular font-bold text-sm text-[#23242B]">
                        {d.code} — {d.percentOff}% off
                      </p>
                      <p className="text-xs text-[#6B6A64]">{d.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleCoupon(d.code)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                        d.active
                          ? 'bg-[#23242B] text-[#FAF9F5]'
                          : 'bg-[#EAE6DA] text-[#6B6A64]'
                      }`}
                    >
                      {d.active ? 'Active' : 'Paused'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* COLUMN 3: RIGHT INSPECTOR PANEL (Spotlight Card, Weekly Strip, Activity) */}
      <aside className="xl:w-[370px] w-full shrink-0 bg-[#FAF9F5] border-t xl:border-t-0 xl:border-l border-[#E5E2D8] px-6 py-7 space-y-8">
        {/* Clean Top Controls (No extra admin info/PII) */}
        <div className="flex items-center justify-between gap-3">
          <span className="font-serif-editorial font-medium text-sm text-[#23242B]">
            Spotlight
          </span>
          <button
            type="button"
            onClick={() => void handleAdminSignOut()}
            className="text-xs font-medium text-[#6B6A64] hover:text-[#E56B5D] cursor-pointer shrink-0"
          >
            Sign out
          </button>
        </div>

        {/* Spotlight Product Inspector (matches book detail card on right panel) */}
        {spotlightProduct && (
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              <img
                src={safeMediaUrl(spotlightProduct.image)}
                alt={spotlightProduct.imageAlt}
                referrerPolicy="no-referrer"
                className="w-24 aspect-[3/4] rounded-xl object-cover border border-[#E5E2D8] shadow-sm shrink-0"
              />
              <div className="min-w-0 space-y-2">
                <h2 className="font-serif-editorial font-medium text-2xl leading-[1.12] text-[#23242B]">
                  {spotlightProduct.title}
                </h2>
                <p className="font-mono-tabular text-xs font-semibold">
                  <span className="text-[#E56B5D]">{uploadedRatioCount}</span>
                  <span className="text-[#6B6A64]">
                    {' '}
                    / {adminProducts.length} PDFs ready
                  </span>
                </p>
                <p className="text-xs text-[#6B6A64] leading-relaxed line-clamp-3">
                  {spotlightProduct.shortDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="font-mono-tabular font-semibold text-[#23242B]">
                ${spotlightProduct.price} USD
              </span>
              <button
                type="button"
                onClick={() => {
                  setTab('products');
                  setEditingProductId(spotlightProduct.id);
                  setEditTitle(spotlightProduct.title);
                  setEditSubtitle(spotlightProduct.subtitle);
                  setEditDesc(spotlightProduct.shortDesc);
                  setEditPriceVal(String(spotlightProduct.price));
                }}
                className="font-semibold text-[#E56B5D] hover:underline cursor-pointer"
              >
                Edit / Upload PDF →
              </button>
            </div>
          </div>
        )}

        <div className="h-px bg-[#E5E2D8]" />

        {/* Weekly Store Schedule Strip (Sun-Sat) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif-editorial font-medium text-base text-[#23242B]">
              Store Pulse
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => setWeekOffset((w) => w - 1)}
                className="w-7 h-7 rounded-full hover:bg-[#EAE6DA] flex items-center justify-center text-[#6B6A64] cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setWeekOffset((w) => w + 1)}
                className="w-7 h-7 rounded-full hover:bg-[#EAE6DA] flex items-center justify-center text-[#6B6A64] cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((day) => (
              <div
                key={day.iso}
                className={`py-2.5 rounded-2xl flex flex-col items-center gap-1 ${
                  day.isToday ? 'bg-[#EAE6DA]' : ''
                }`}
              >
                <span
                  className={`text-[11px] font-medium ${
                    day.isToday ? 'text-[#E56B5D]' : 'text-[#6B6A64]'
                  }`}
                >
                  {day.label}
                </span>
                <span className="font-mono-tabular text-xs font-bold text-[#23242B]">
                  {day.dateNum}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-px bg-[#E5E2D8]" />

        {/* Recent Customer Activity Timeline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif-editorial font-medium text-base text-[#23242B]">
              Customer Activity
            </h3>
            <button
              type="button"
              onClick={() => setTab('orders')}
              className="text-xs font-medium text-[#6B6A64] hover:text-[#23242B] cursor-pointer"
            >
              See all
            </button>
          </div>

          {activityFeed.length === 0 ? (
            <p className="text-xs text-[#6B6A64] leading-relaxed">
              Customer orders, newsletter signups, and inbox messages appear
              here automatically.
            </p>
          ) : (
            <div className="space-y-4">
              {activityFeed.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-full text-[#FAF9F5] flex items-center justify-center text-[10px] font-bold uppercase shrink-0 mt-0.5"
                    style={{ backgroundColor: ev.accent }}
                  >
                    {ev.author.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#23242B] truncate">
                        {ev.author}
                      </p>
                      <span className="text-[10px] text-[#6B6A64] shrink-0 font-mono-tabular">
                        {ev.time}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6A64] mt-0.5 line-clamp-2 leading-relaxed">
                      {ev.note}
                    </p>
                    <p className="text-[11px] font-medium text-[#E56B5D] mt-1">
                      {ev.meta}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
