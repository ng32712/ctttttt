import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import {
  mapAuthError,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  updateUserProfileName,
} from '../lib/firebase';
import { downloadVerifiedProductPackage } from '../lib/payments';
import { useStore } from '../context/StoreContext';

type AuthMode = 'signin' | 'signup' | 'reset';
type DashTab = 'overview' | 'orders' | 'downloads' | 'settings';

export default function AccountPage() {
  const navigate = useNavigate();
  const {
    user,
    authLoading,
    setAdminToken,
    orders,
    products,
    refreshMyOrders,
    signOut,
  } = useStore();

  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');

  const [tab, setTab] = useState<DashTab>('overview');
  const [profileName, setProfileName] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [roleCheckedUid, setRoleCheckedUid] = useState<string | null>(null);

  const routeIfServerVerifiedAdmin = async (
    signedInUser: { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> }
  ): Promise<boolean> => {
    try {
      const idToken = await signedInUser.getIdToken();
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        role?: string;
        autoPassAdmin?: boolean;
      };
      if (data.role === 'admin') {
        navigate('/admin', { replace: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (authLoading || !user) {
      if (!user) setRoleCheckedUid(null);
      return;
    }

    void (async () => {
      const redirected = await routeIfServerVerifiedAdmin(user);
      if (!cancelled && !redirected) {
        setRoleCheckedUid(user.uid);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthNotice('');
    setAuthBusy(true);
    try {
      if (authMode === 'signin') {
        try {
          const cred = await signInWithEmail(email, password);
          await routeIfServerVerifiedAdmin(cred.user);
        } catch (firebaseErr) {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password }),
          });
          if (res.status === 429) {
            const errData = (await res.json().catch(() => ({}))) as { error?: string };
            setAuthError(
              errData.error || 'Too many failed attempts. Please wait and try again.'
            );
            return;
          }
          if (res.ok) {
            const data = (await res.json()) as { adminToken?: string };
            if (data.adminToken) {
              setAdminToken(data.adminToken);
              navigate('/admin', { replace: true });
              return;
            }
          }
          throw firebaseErr;
        }
      } else if (authMode === 'signup') {
        const cred = await signUpWithEmail(name, email, password);
        await routeIfServerVerifiedAdmin(cred.user);
      } else {
        await sendPasswordReset(email);
        setAuthNotice('Password reset instructions sent to your email.');
      }
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setAuthNotice('');
    setAuthBusy(true);
    try {
      const cred = await signInWithGoogle();
      await routeIfServerVerifiedAdmin(cred.user);
    } catch (err) {
      setAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !profileName.trim()) return;
    try {
      await updateUserProfileName(user, profileName);
      setProfileMsg('Display name updated.');
    } catch (err) {
      setProfileMsg(mapAuthError(err));
    }
  };

  const isRoleCheckPending = Boolean(user && roleCheckedUid !== user.uid);

  if (authLoading || isRoleCheckPending) {
    return (
      <div className="pt-32 pb-24 min-h-screen bg-[#F3F1EA] flex items-center justify-center">
        <p className="text-sm font-medium text-[#6B6A64]">
          Verifying account session...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-[#F3F1EA] px-5">
        <div className="max-w-md mx-auto rounded-3xl bg-[#FAF9F5] border border-[#E5E2D8] p-7 md:p-9 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#E56B5D]">
            Firebase Authentication
          </p>
          <h1 className="font-serif-editorial font-medium text-3xl text-[#23242B] mt-1">
            {authMode === 'signin'
              ? 'Sign in to CraftedLabs'
              : authMode === 'signup'
              ? 'Create your account'
              : 'Reset password'}
          </h1>
          <p className="text-sm text-[#6B6A64] mt-2">
            Access your verified backend order history, purchased PDFs, and
            account preferences.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#EAE6DA]">
            {(['signin', 'signup', 'reset'] as AuthMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setAuthMode(m);
                  setAuthError('');
                  setAuthNotice('');
                }}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  authMode === m
                    ? 'bg-[#FAF9F5] text-[#23242B] shadow-xs'
                    : 'text-[#6B6A64] hover:text-[#23242B]'
                }`}
              >
                {m === 'signin' ? 'Sign In' : m === 'signup' ? 'Sign Up' : 'Recover'}
              </button>
            ))}
          </div>

          <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
            {authMode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-medium text-[#6B6A64] mb-1"
                >
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Mugisha"
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[#6B6A64] mb-1"
              >
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
              />
            </div>

            {authMode !== 'reset' && (
              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-[#6B6A64] mb-1"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
              </div>
            )}

            {authError && (
              <p className="p-3 rounded-xl bg-[#E56B5D]/12 text-xs font-medium text-[#23242B]">
                {authError}
              </p>
            )}
            {authNotice && (
              <p className="p-3 rounded-xl bg-[#EAE6DA] text-xs font-medium text-[#23242B]">
                {authNotice}
              </p>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-3 px-5 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-sm font-semibold btn-tactile cursor-pointer"
            >
              {authBusy
                ? 'Please wait...'
                : authMode === 'signin'
                ? 'Sign In'
                : authMode === 'signup'
                ? 'Create Account'
                : 'Send Reset Email'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-[#6B6A64]">
            <div className="h-px flex-1 bg-[#E5E2D8]" />
            <span>or</span>
            <div className="h-px flex-1 bg-[#E5E2D8]" />
          </div>

          <button
            type="button"
            disabled={authBusy}
            onClick={handleGoogleSignIn}
            className="w-full py-3 px-5 rounded-full border border-[#E5E2D8] bg-white hover:bg-[#EAE6DA] text-sm font-semibold text-[#23242B] btn-tactile cursor-pointer"
          >
            Continue with Google
          </button>

          <p className="mt-5 text-[11px] text-[#6B6A64] text-center leading-relaxed">
            Connected to Firebase Auth project{' '}
            <span className="font-mono-tabular">bounty-c1dfb</span>.
          </p>
        </div>
      </div>
    );
  }

  const purchasedItems = orders.flatMap((order) =>
    order.items.map((item) => ({
      order,
      item,
      product: products.find((p) => p.id === item.productId),
    }))
  );

  return (
    <div className="pt-24 pb-20 min-h-screen bg-[#F3F1EA]">
      <div className="max-w-[1200px] mx-auto px-5 md:px-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#E56B5D]">
              Customer Account
            </p>
            <h1 className="font-serif-editorial font-medium text-3xl md:text-4xl text-[#23242B] mt-1">
              Welcome, {user.displayName || user.email}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-white text-xs font-semibold text-[#23242B] self-start cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {(
            [
              { id: 'overview', label: 'Overview', icon: UserIcon },
              { id: 'orders', label: `Orders (${orders.length})`, icon: Package },
              {
                id: 'downloads',
                label: `Downloads (${purchasedItems.length})`,
                icon: Download,
              },
              { id: 'settings', label: 'Settings', icon: Settings },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  tab === t.id
                    ? 'bg-[#23242B] text-[#FAF9F5]'
                    : 'bg-[#FAF9F5] text-[#6B6A64] border border-[#E5E2D8] hover:text-[#23242B]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
              <p className="text-xs text-[#6B6A64]">Signed-in Email</p>
              <p className="font-semibold text-sm text-[#23242B] mt-1 break-all">
                {user.email}
              </p>
              <p className="text-xs text-[#E56B5D] mt-3 inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified by Backend &amp; Firebase
              </p>
            </div>
            <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
              <p className="text-xs text-[#6B6A64]">Orders</p>
              <p className="font-mono-tabular font-bold text-3xl text-[#23242B] mt-1">
                {orders.length}
              </p>
            </div>
            <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
              <p className="text-xs text-[#6B6A64]">Available Downloads</p>
              <p className="font-mono-tabular font-bold text-3xl text-[#E56B5D] mt-1">
                {purchasedItems.length}
              </p>
            </div>
          </div>
        )}

        {tab === 'orders' && (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
            <h2 className="font-serif-editorial font-medium text-xl text-[#23242B] mb-4">
              Order History
            </h2>
            {orders.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-[#6B6A64]">
                  No orders recorded for this account yet.
                </p>
                <Link
                  to="/books"
                  className="mt-4 inline-flex px-5 py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold"
                >
                  Browse Books
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="p-4 rounded-xl border border-[#E5E2D8] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-mono-tabular font-bold text-sm text-[#23242B]">
                        {order.id} · {order.status}
                      </p>
                      <p className="text-xs text-[#6B6A64] mt-1">
                        {new Date(order.createdAt).toLocaleString()} ·{' '}
                        {order.items.map((i) => i.title).join(', ')}
                      </p>
                    </div>
                    <span className="font-mono-tabular font-bold text-base text-[#E56B5D]">
                      ${order.total.toFixed(2)} USD
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'downloads' && (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6">
            <h2 className="font-serif-editorial font-medium text-xl text-[#23242B] mb-2">
              Purchased Products &amp; Download History
            </h2>
            <p className="text-xs text-[#6B6A64] mb-5">
              Files are gated by server-side ownership checks and stream the
              digital edition included with your verified order.
            </p>
            {purchasedItems.length === 0 ? (
              <p className="text-sm text-[#6B6A64] py-6">
                You have not completed a purchase yet.
              </p>
            ) : (
              <div className="space-y-3">
                {purchasedItems.map(({ order, item, product }) => {
                  const key = `${order.id}-${item.productId}`;
                  return (
                    <div
                      key={key}
                      className="p-4 rounded-xl border border-[#E5E2D8] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <p className="font-semibold text-sm text-[#23242B]">
                          {item.title}
                        </p>
                        <p className="text-xs text-[#6B6A64] mt-0.5">
                          Order {order.id} · Downloads recorded:{' '}
                          <span className="font-mono-tabular">
                            {order.downloadCount}
                          </span>
                          {product?.hasUploadedFile && product.deliverableFileName
                            ? ` · File: ${product.deliverableFileName}`
                            : ''}
                        </p>
                      </div>
                      {product && (
                        <button
                          type="button"
                          disabled={downloadingKey === key}
                          onClick={async () => {
                            setDownloadingKey(key);
                            const ok = await downloadVerifiedProductPackage(
                              product,
                              order
                            );
                            if (ok) await refreshMyOrders();
                            setDownloadingKey(null);
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#23242B] hover:bg-[#32343D] disabled:opacity-60 text-[#FAF9F5] text-xs font-semibold cursor-pointer self-start"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {downloadingKey === key
                            ? 'Downloading...'
                            : product.hasUploadedFile
                            ? 'Download PDF / File'
                            : 'Download'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-6 max-w-lg space-y-6">
            <h2 className="font-serif-editorial font-medium text-xl text-[#23242B]">
              Account Settings
            </h2>
            <form onSubmit={handleSaveName} className="space-y-4">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-xs font-medium text-[#6B6A64] mb-1"
                >
                  Display Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder={user.displayName || 'Your Name'}
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
              </div>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-full bg-[#23242B] text-[#FAF9F5] text-xs font-semibold cursor-pointer"
              >
                Update Profile Name
              </button>
              {profileMsg && (
                <p className="text-xs text-[#23242B] font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#E56B5D]" />
                  {profileMsg}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
