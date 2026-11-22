import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Layers, Plus } from 'lucide-react';
import { CATEGORIES } from '../data/catalog';
import { useStore } from '../context/StoreContext';
import { safeMediaUrl } from '../lib/sanitize';
import type { Product } from '../types/store';

export default function ProductCard({ product }: { product: Product }) {
  const { addToCart } = useStore();
  const [imgError, setImgError] = useState(false);

  const categoryName =
    CATEGORIES.find((c) => c.id === product.category)?.name ?? 'Digital Tool';

  return (
    <article className="group rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-[#CFCBC0]">
      <Link
        to={`/product/${product.slug}`}
        className="relative aspect-[4/3] w-full overflow-hidden bg-[#EAE6DA] block"
      >
        {!imgError ? (
          <img
            src={safeMediaUrl(product.image)}
            alt={product.imageAlt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#F3F1EA] to-[#FAF9F5]">
            <Layers className="w-8 h-8 text-[#E56B5D] mb-2" />
            <span className="font-serif-editorial font-medium text-sm text-[#23242B]">
              {product.title}
            </span>
          </div>
        )}
      </Link>

      <div className="p-6 flex flex-col flex-1 justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#6B6A64] mb-2">
            <span className="truncate">{categoryName}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap shrink-0 font-medium text-[#E56B5D]">
              {product.productType}
            </span>
          </div>

          <Link to={`/product/${product.slug}`} className="block">
            <h3 className="font-serif-editorial font-medium text-xl text-[#23242B] group-hover:text-[#E56B5D] transition-colors leading-snug">
              {product.title}
            </h3>
          </Link>

          <p className="text-sm text-[#6B6A64] mt-2 leading-relaxed line-clamp-2">
            {product.shortDesc}
          </p>
        </div>

        <div className="pt-5 mt-5 border-t border-[#E5E2D8] flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono-tabular font-bold text-xl text-[#23242B]">
              {product.price === 0 ? 'Free' : `$${product.price}`}
            </span>
            {product.compareAtPrice && (
              <span className="font-mono-tabular text-xs text-[#6B6A64] line-through">
                ${product.compareAtPrice}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              to={`/product/${product.slug}`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-[#E5E2D8] bg-white hover:bg-[#F3F1EA] text-xs font-semibold text-[#23242B] whitespace-nowrap shrink-0 transition-colors"
            >
              Details
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => addToCart(product.id, true)}
              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-xs font-semibold whitespace-nowrap shrink-0 btn-tactile cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
