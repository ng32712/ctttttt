import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { FREE_RESOURCES } from '../data/catalog';
import { safeMediaUrl } from '../lib/sanitize';

export default function SearchModal() {
  const { searchOpen, setSearchOpen, products, blogArticles } = useStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchOpen, setSearchOpen]);

  if (!searchOpen) return null;

  const q = query.trim().toLowerCase();
  const matchedProducts = products.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.shortDesc.toLowerCase().includes(q) ||
      p.productType.toLowerCase().includes(q)
  );
  const matchedArticles = blogArticles.filter(
    (a) =>
      !q ||
      a.title.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
  );
  const matchedFree = FREE_RESOURCES.filter(
    (r) => !q || r.title.toLowerCase().includes(q)
  );

  return (
    <div className="fixed inset-0 z-80 flex items-start justify-center pt-20 px-4">
      <div
        className="fixed inset-0 bg-[#23242B]/50 backdrop-blur-xs"
        onClick={() => setSearchOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search CraftedLabs"
        className="relative z-90 w-full max-w-2xl bg-[#FAF9F5] rounded-2xl border border-[#E5E2D8] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E5E2D8]">
          <Search className="w-5 h-5 text-[#E56B5D] shrink-0" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SoloBiz OS, templates, AI playbooks, or articles..."
            className="w-full bg-transparent text-base text-[#23242B] placeholder:text-[#6B6A64] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
            className="w-8 h-8 rounded-full hover:bg-[#EAE6DA] flex items-center justify-center text-[#6B6A64] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5 space-y-6">
          <div>
            <p className="text-xs font-semibold text-[#6B6A64] mb-2.5">
              Products ({matchedProducts.length})
            </p>
            {matchedProducts.length === 0 ? (
              <p className="text-sm text-[#6B6A64]">No matching products found.</p>
            ) : (
              <div className="space-y-2">
                {matchedProducts.slice(0, 5).map((p) => (
                  <Link
                    key={p.id}
                    to={`/product/${p.slug}`}
                    onClick={() => setSearchOpen(false)}
                    className="flex items-center justify-between gap-4 p-2.5 rounded-xl hover:bg-[#F3F1EA] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={safeMediaUrl(p.image)}
                        alt={p.imageAlt}
                        className="w-12 h-10 rounded-lg object-cover border border-[#E5E2D8] shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#23242B] truncate">
                          {p.title}
                        </p>
                        <p className="text-xs text-[#6B6A64] truncate">
                          {p.productType}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono-tabular text-sm font-bold text-[#E56B5D] shrink-0">
                      {p.price === 0 ? 'Free' : `$${p.price}`}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {matchedFree.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#6B6A64] mb-2">
                Free Resources ({matchedFree.length})
              </p>
              <div className="space-y-1.5">
                {matchedFree.map((res) => (
                  <Link
                    key={res.id}
                    to="/#free-resources"
                    onClick={() => setSearchOpen(false)}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F3F1EA] text-sm text-[#23242B]"
                  >
                    <span>{res.title}</span>
                    <span className="text-xs font-semibold text-[#E56B5D]">
                      Free
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {matchedArticles.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#6B6A64] mb-2">
                Journal &amp; Articles ({matchedArticles.length})
              </p>
              <div className="space-y-1.5">
                {matchedArticles.slice(0, 3).map((art) => (
                  <Link
                    key={art.id}
                    to={`/blog/${art.slug}`}
                    onClick={() => setSearchOpen(false)}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[#F3F1EA] text-sm text-[#23242B]"
                  >
                    <span className="truncate">{art.title}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#E56B5D] shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
