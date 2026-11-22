import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, Search, ShoppingBag, User as UserIcon, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export default function Navbar() {
  const {
    user,
    cartCount,
    storefrontSettings,
    setCartDrawerOpen,
    setSearchOpen,
  } = useStore();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap shrink-0 text-sm font-medium transition-colors py-1 border-b-2 ${
      isActive
        ? 'text-[#23242B] border-[#E56B5D]'
        : 'text-[#6B6A64] border-transparent hover:text-[#23242B] hover:border-[#E56B5D]/45'
    }`;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-200 ${
        scrolled
          ? 'bg-[#FAF9F5]/92 backdrop-blur-lg border-b border-[#E5E2D8] shadow-xs'
          : 'bg-[#F3F1EA]/85 backdrop-blur-md border-b border-[#E5E2D8]/80'
      }`}
    >
      <div className="max-w-[1360px] mx-auto h-full px-5 md:px-10 flex items-center justify-between gap-6">
        {/* Zone 1: Brand Lockup */}
        <Link
          to="/"
          className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 font-serif-editorial font-bold text-xl tracking-tight text-[#23242B]"
          aria-label={`${storefrontSettings.storeName} Home`}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            className="text-[#23242B]"
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
          <span>{storefrontSettings.storeName || 'CraftedLabs'}</span>
        </Link>

        {/* Zone 2: Customer Navigation (Home, Books, About) */}
        <nav
          className="hidden lg:flex items-center gap-8"
          aria-label="Customer Navigation"
        >
          <NavLink to="/" end className={navItemClass}>
            Home
          </NavLink>
          <NavLink
            to="/books"
            className={({ isActive }) =>
              navItemClass({
                isActive: isActive || location.pathname === '/shop',
              })
            }
          >
            Books
          </NavLink>
          <NavLink to="/about" className={navItemClass}>
            About
          </NavLink>
        </nav>

        {/* Zone 3: Search, Cart, Account & Primary CTA */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search books and resources"
            className="w-10 h-10 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-white flex items-center justify-center text-[#23242B] transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            aria-label="Open shopping bag"
            className="relative w-10 h-10 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-white flex items-center justify-center text-[#23242B] transition-colors cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-[#E56B5D] text-[#FAF9F5] font-mono-tabular text-[11px] font-bold flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>

          <Link
            to="/account"
            className="hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-3.5 py-2 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-white text-sm font-medium text-[#23242B] transition-colors"
          >
            <UserIcon className="w-3.5 h-3.5 text-[#E56B5D]" />
            <span>{user ? (user.displayName?.split(' ')[0] || 'Account') : 'Sign In'}</span>
          </Link>

          <Link
            to="/books"
            className="hidden md:inline-flex items-center justify-center whitespace-nowrap shrink-0 px-5 py-2.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold btn-tactile"
          >
            Browse Books
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden w-10 h-10 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] flex items-center justify-center text-[#23242B] cursor-pointer"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden bg-[#FAF9F5] border-b border-[#E5E2D8] px-5 py-5 shadow-lg">
          <div className="flex flex-col gap-3">
            <Link to="/" className="py-2 text-base font-medium text-[#23242B]">
              Home
            </Link>
            <Link to="/books" className="py-2 text-base font-medium text-[#23242B]">
              Books
            </Link>
            <Link to="/about" className="py-2 text-base font-medium text-[#23242B]">
              About
            </Link>
            <Link to="/account" className="py-2 text-base font-medium text-[#E56B5D]">
              {user ? `Account (${user.email})` : 'Sign In / Create Account'}
            </Link>
            <Link
              to="/books"
              className="mt-2 inline-flex items-center justify-center px-5 py-3 rounded-full bg-[#23242B] text-[#FAF9F5] text-sm font-semibold"
            >
              Browse Books
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
