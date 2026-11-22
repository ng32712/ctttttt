import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { CATEGORIES } from '../data/catalog';
import { useStore } from '../context/StoreContext';
import ProductCard from '../components/ProductCard';
import type { CategoryId } from '../types/store';

type PriceRange = 'all' | 'under-10' | '10-15' | 'over-15';
type SortOption = 'newest' | 'price-asc' | 'price-desc';

const PAGE_SIZE = 6;

export default function ShopPage() {
  const { products, storefrontSettings } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialCat = (searchParams.get('category') as CategoryId | 'all') || 'all';
  const [category, setCategory] = useState<CategoryId | 'all'>(initialCat);
  const [search, setSearch] = useState('');
  const [priceRange, setPriceRange] = useState<PriceRange>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const paramCat = searchParams.get('category') as CategoryId | null;
    if (paramCat && CATEGORIES.some((c) => c.id === paramCat)) {
      setCategory(paramCat);
    } else if (!paramCat) {
      setCategory('all');
    }
  }, [searchParams]);

  const handleCategoryChange = (next: CategoryId | 'all') => {
    setCategory(next);
    setVisibleCount(PAGE_SIZE);
    if (next === 'all') {
      searchParams.delete('category');
    } else {
      searchParams.set('category', next);
    }
    setSearchParams(searchParams);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.shortDesc.toLowerCase().includes(q) &&
        !p.productType.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (priceRange === 'under-10' && p.price >= 10) return false;
      if (priceRange === '10-15' && (p.price < 10 || p.price > 15)) return false;
      if (priceRange === 'over-15' && p.price <= 15) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'price-asc') return a.price - b.price;
      if (sortBy === 'price-desc') return b.price - a.price;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [products, category, search, priceRange, sortBy]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMore = visibleProducts.length < filteredProducts.length;

  const resetAll = () => {
    setSearch('');
    setPriceRange('all');
    setSortBy('newest');
    handleCategoryChange('all');
  };

  return (
    <div className="pt-24 pb-20 min-h-screen bg-[#F3F1EA]">
      <div className="max-w-[1360px] mx-auto px-5 md:px-10">
        {/* Header */}
        <div className="max-w-3xl mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#E56B5D] mb-2">
            {storefrontSettings.storeName} Catalog
          </p>
          <h1 className="font-serif-editorial font-medium text-4xl md:text-5xl tracking-tight text-[#23242B]">
            Books &amp; Digital Guides
          </h1>
          <p className="text-base text-[#6B6A64] mt-3 leading-relaxed">
            Practical digital books, spreadsheets, prompt libraries, and study
            planners with instant digital delivery.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[#FAF9F5] border border-[#E56B5D]/35 px-4 py-2.5 text-xs font-medium text-[#23242B]">
            <span className="w-2 h-2 rounded-full bg-[#E56B5D] shrink-0" />
            <span>
              <strong>Notice:</strong> Online payments are coming soon — every eBook is currently <strong>free</strong> to download.
            </span>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-5 mb-10 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-[#6B6A64] absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="Search by tool, format, or keyword..."
                aria-label="Search store products"
                className="w-full pl-11 pr-4 py-2.5 rounded-full bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
              />
            </div>

            <div className="lg:col-span-7 flex flex-wrap items-center justify-start lg:justify-end gap-3">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-[#6B6A64]">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#E56B5D]" />
                <span>Price:</span>
              </div>
              <select
                value={priceRange}
                onChange={(e) => {
                  setPriceRange(e.target.value as PriceRange);
                  setVisibleCount(PAGE_SIZE);
                }}
                aria-label="Filter by price"
                className="px-3.5 py-2 rounded-full bg-white border border-[#E5E2D8] text-xs font-medium text-[#23242B] focus:outline-none focus:border-[#23242B]"
              >
                <option value="all">All Prices</option>
                <option value="under-10">Under $10</option>
                <option value="10-15">$10 – $15</option>
                <option value="over-15">Over $15</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort products"
                className="px-3.5 py-2 rounded-full bg-white border border-[#E5E2D8] text-xs font-medium text-[#23242B] focus:outline-none focus:border-[#23242B]"
              >
                <option value="newest">Sort: Newest</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
            </div>
          </div>

          {/* Category Segmented Filter Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E5E2D8]">
            <button
              type="button"
              onClick={() => handleCategoryChange('all')}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                category === 'all'
                  ? 'bg-[#23242B] text-[#FAF9F5]'
                  : 'bg-[#F3F1EA] text-[#6B6A64] hover:text-[#23242B]'
              }`}
            >
              All Categories
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryChange(cat.id)}
                className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  category === cat.id
                    ? 'bg-[#23242B] text-[#FAF9F5]'
                    : 'bg-[#F3F1EA] text-[#6B6A64] hover:text-[#23242B]'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Results Meta */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 text-xs text-[#6B6A64]">
          <span>
            Showing <strong className="font-mono-tabular text-[#23242B]">{visibleProducts.length}</strong> of{' '}
            <strong className="font-mono-tabular text-[#23242B]">{filteredProducts.length}</strong> digital books &amp; guides
          </span>
          <span>Instant digital downloads · Verified editions</span>
        </div>

        {/* Grid or Empty State */}
        {visibleProducts.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-12 text-center max-w-lg mx-auto">
            <h2 className="font-serif-editorial font-medium text-2xl text-[#23242B]">
              No tools match those filters
            </h2>
            <p className="text-sm text-[#6B6A64] mt-2">
              Try clearing your search term or switching back to all categories.
            </p>
            <button
              type="button"
              onClick={resetAll}
              className="mt-6 px-6 py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold btn-tactile cursor-pointer"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-7 py-3.5 rounded-full bg-[#FAF9F5] border border-[#E5E2D8] hover:border-[#23242B] text-sm font-semibold text-[#23242B] btn-tactile cursor-pointer"
                >
                  Load More Products
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
