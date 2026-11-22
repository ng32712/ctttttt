import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Sparkles,
} from 'lucide-react';
import { initHeroCanvas } from '../webgl/heroCanvas';
import { initSpecsCanvas } from '../webgl/specsCanvas';
import {
  CATEGORIES,
  FREE_RESOURCES,
  SHOWCASE_STAGES,
  STUDIO_MEDIA,
} from '../data/catalog';
import { useStore } from '../context/StoreContext';
import { safeMediaUrl } from '../lib/sanitize';
import ProductCard from '../components/ProductCard';
import SoloBizInteractivePreview from '../components/SoloBizInteractivePreview';

gsap.registerPlugin(ScrollTrigger);

export default function HomePage() {
  const {
    products,
    blogArticles,
    storefrontSettings,
    setActiveFreeResource,
    addSubscriber,
  } = useStore();

  const [activeStage, setActiveStage] = useState(0);
  const [captionBlur, setCaptionBlur] = useState(false);

  // Newsletter form state
  const [nlFirstName, setNlFirstName] = useState('');
  const [nlEmail, setNlEmail] = useState('');
  const [nlConsent, setNlConsent] = useState(false);
  const [nlStatus, setNlStatus] = useState<'idle' | 'error' | 'done'>('idle');
  const [nlMessage, setNlMessage] = useState('');

  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroStageRef = useRef<HTMLDivElement | null>(null);
  const tiltWrapRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const showcaseRef = useRef<HTMLElement | null>(null);
  const frameRefs = useRef<(HTMLElement | null)[]>([]);
  const categoriesGridRef = useRef<HTMLDivElement | null>(null);
  const stageIdxRef = useRef(0);
  const stageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const cleanupHeroGl = initHeroCanvas(heroCanvasRef.current);
    const cleanupSpecsGl = initSpecsCanvas(specsCanvasRef.current);

    let lenis: InstanceType<typeof Lenis> | null = null;
    let lenisTicker: ((time: number) => void) | null = null;
    if (!prefersReduced) {
      lenis = new Lenis({
        duration: 1.0,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      lenis.on('scroll', ScrollTrigger.update);
      lenisTicker = (time: number) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(lenisTicker);
      gsap.ticker.lagSmoothing(0);
    }

    // 3D Pointer-Tracking Physics Tilt on Hero Collage Stage
    let targetRotX = 0;
    let targetRotY = 0;
    let curRotX = 0;
    let curRotY = 0;
    let velX = 0;
    let velY = 0;
    let tiltTicker: (() => void) | null = null;

    const heroStage = heroStageRef.current;
    const onHeroMove = (e: PointerEvent) => {
      if (!heroStage) return;
      const rect = heroStage.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetRotY = nx * 10;
      targetRotX = -ny * 7;
    };
    const onHeroLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
    };

    if (heroStage && tiltWrapRef.current && !prefersReduced) {
      heroStage.addEventListener('pointermove', onHeroMove);
      heroStage.addEventListener('pointerleave', onHeroLeave);
      tiltTicker = () => {
        const ax = (targetRotX - curRotX) * 0.08;
        const ay = (targetRotY - curRotY) * 0.08;
        velX = (velX + ax) * 0.82;
        velY = (velY + ay) * 0.82;
        curRotX += velX;
        curRotY += velY;
        if (tiltWrapRef.current) {
          tiltWrapRef.current.style.transform = `rotateX(${curRotX.toFixed(
            2
          )}deg) rotateY(${curRotY.toFixed(2)}deg)`;
        }
        if (shadowRef.current) {
          shadowRef.current.style.transform = `translateX(${(
            -curRotY * 1.4
          ).toFixed(1)}px) scale(${1 - Math.abs(curRotX) * 0.01})`;
        }
      };
      gsap.ticker.add(tiltTicker);
    }

    const gsapCtx = gsap.context(() => {
      if (prefersReduced) return;

      const frames = frameRefs.current.filter(
        (el): el is HTMLElement => el !== null
      );
      if (showcaseRef.current && frames.length === 4) {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: showcaseRef.current,
            start: 'top top',
            end: '+=240%',
            pin: true,
            scrub: 0.65,
            onUpdate: (self: { progress: number }) => {
              const t = self.progress * 3.5;
              let nextIdx = 0;
              if (t >= 3.07) nextIdx = 3;
              else if (t >= 2.02) nextIdx = 2;
              else if (t >= 0.97) nextIdx = 1;

              if (nextIdx !== stageIdxRef.current) {
                stageIdxRef.current = nextIdx;
                setCaptionBlur(true);
                if (stageTimerRef.current !== null) {
                  window.clearTimeout(stageTimerRef.current);
                }
                stageTimerRef.current = window.setTimeout(() => {
                  stageTimerRef.current = null;
                  setActiveStage(nextIdx);
                  setCaptionBlur(false);
                }, 100);
              }
            },
          },
        });

        const wipeStarts = [0.25, 1.3, 2.35];
        frames.forEach((frame, i) => {
          if (i === 0) return;
          tl.fromTo(
            frame,
            { clipPath: 'inset(0 0 0 100%)' },
            { clipPath: 'inset(0 0 0 0%)', ease: 'none', duration: 0.8 },
            wipeStarts[i - 1]
          );
        });
        tl.set({}, {}, 3.5);
      }

      if (categoriesGridRef.current) {
        gsap.from('.reveal-tile', {
          y: 24,
          scale: 0.97,
          opacity: 0,
          duration: 0.6,
          stagger: 0.08,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: categoriesGridRef.current,
            start: 'top 84%',
            once: true,
          },
        });
      }
    });

    return () => {
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      cleanupHeroGl();
      cleanupSpecsGl();
      gsapCtx.revert();
      if (tiltTicker) gsap.ticker.remove(tiltTicker);
      if (lenisTicker) gsap.ticker.remove(lenisTicker);
      lenis?.destroy();
      heroStage?.removeEventListener('pointermove', onHeroMove);
      heroStage?.removeEventListener('pointerleave', onHeroLeave);
    };
  }, []);

  const selectStage = (idx: number) => {
    stageIdxRef.current = idx;
    setCaptionBlur(true);
    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
    }
    stageTimerRef.current = window.setTimeout(() => {
      stageTimerRef.current = null;
      setActiveStage(idx);
      setCaptionBlur(false);
    }, 110);
    frameRefs.current.forEach((frame, i) => {
      if (!frame) return;
      frame.style.clipPath =
        i <= idx ? 'inset(0 0 0 0%)' : 'inset(0 0 0 100%)';
    });
  };

  const handleNewsletterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nlEmail.trim() || !nlEmail.includes('@')) {
      setNlStatus('error');
      setNlMessage('Please enter a valid email address.');
      return;
    }
    if (!nlConsent) {
      setNlStatus('error');
      setNlMessage('Please confirm email consent before subscribing.');
      return;
    }
    try {
      await addSubscriber({
        firstName: nlFirstName.trim() || undefined,
        email: nlEmail.trim(),
        consentGiven: true,
        source: 'newsletter',
      });
      setNlStatus('done');
      setNlMessage('You are on the list. Thank you for joining CraftedLabs.');
      setNlFirstName('');
      setNlEmail('');
      setNlConsent(false);
    } catch (err) {
      setNlStatus('error');
      setNlMessage(
        err instanceof Error ? err.message : 'Could not complete subscription.'
      );
    }
  };

  const spotlightProduct =
    products.find((p) => p.id === storefrontSettings.spotlightProductId) ||
    products[0];
  const featuredProducts = (
    products.filter((p) => p.featured).length > 0
      ? products.filter((p) => p.featured)
      : products
  ).slice(0, 4);

  const announcementParts = storefrontSettings.announcementText
    .split(/[•·]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="pt-16">
      {/* 1. HERO SECTION with WebGL2 Parchment Contours & 3D Spotlight Collage */}
      <section className="relative min-h-[calc(100dvh-64px)] flex items-center overflow-hidden py-12 md:py-16">
        <canvas
          ref={heroCanvasRef}
          className="absolute inset-0 w-full h-full z-0 pointer-events-none"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-[1360px] mx-auto px-5 md:px-10 w-full grid grid-cols-1 lg:grid-cols-12 items-center gap-12 lg:gap-10">
          {/* Left Hero Copy (Driven Live by Admin Studio) */}
          <div className="lg:col-span-6 space-y-6">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase text-[#E56B5D]">
              {storefrontSettings.heroEyebrow}
            </p>
            <h1 className="font-serif-editorial font-medium text-[clamp(2.65rem,4.8vw,4.35rem)] leading-[1.03] tracking-tight text-[#23242B] [text-wrap:balance]">
              {storefrontSettings.heroHeadline}
            </h1>
            <p className="text-base md:text-lg text-[#6B6A64] leading-relaxed max-w-[48ch]">
              {storefrontSettings.heroSubtitle}
            </p>

            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Link
                to="/books"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] font-semibold text-sm md:text-base btn-tactile"
              >
                {storefrontSettings.heroCtaText}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#free-resources"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-[#E5E2D8] bg-[#FAF9F5] hover:bg-white text-[#23242B] font-semibold text-sm md:text-base btn-tactile"
              >
                Discover Free Resources
              </a>
            </div>

            <div className="inline-flex items-center gap-2 rounded-2xl bg-[#FAF9F5]/95 border border-[#E56B5D]/35 px-4 py-2.5 text-xs text-[#23242B] shadow-xs">
              <span className="w-2 h-2 rounded-full bg-[#E56B5D] shrink-0" />
              <span>
                <strong>Notice:</strong> Online payments are coming soon — every eBook is currently <strong>free</strong>.
              </span>
            </div>

            <p className="text-xs md:text-sm text-[#6B6A64] pt-1">
              Practical resources · Instant free access · Built for real-world use
            </p>
          </div>

          {/* Right Hero 3D Spotlight Collage Stage */}
          <div
            ref={heroStageRef}
            className="lg:col-span-6 hero-stage-3d relative flex flex-col items-center justify-center py-4"
          >
            <div
              ref={tiltWrapRef}
              className="collage-tilt-wrap relative w-full max-w-[560px]"
            >
              {spotlightProduct && (
                <div className="relative z-10 rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] p-3.5 shadow-[0_24px_54px_rgba(35,36,43,0.10)]">
                  <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EAE6DA]">
                    <img
                      src={safeMediaUrl(spotlightProduct.image)}
                      alt={spotlightProduct.imageAlt}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="mt-3.5 px-2 pb-1 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-serif-editorial font-medium text-base text-[#23242B] truncate">
                        {spotlightProduct.title}
                      </p>
                      <p className="text-xs text-[#6B6A64] truncate">
                        {spotlightProduct.productType}
                      </p>
                    </div>
                    <Link
                      to={`/product/${spotlightProduct.slug}`}
                      className="px-4 py-1.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] font-mono-tabular text-xs font-bold whitespace-nowrap shrink-0"
                    >
                      {spotlightProduct.price === 0
                        ? 'Free'
                        : `$${spotlightProduct.price} USD`}
                    </Link>
                  </div>
                </div>
              )}

              {/* Floating Editorial Template Card (top-left) */}
              <div className="hidden sm:block absolute -top-6 -left-6 z-20 w-44 rounded-xl bg-[#FAF9F5] border border-[#E5E2D8] p-2.5 shadow-lg float-slow">
                <img
                  src={STUDIO_MEDIA.catDesign}
                  alt="Website template preview"
                  className="w-full h-24 object-cover rounded-lg border border-[#E5E2D8]"
                />
                <p className="mt-2 font-medium text-[11px] text-[#23242B]">
                  Editorial UI Templates
                </p>
              </div>

              {/* Floating Digital Planner Card (bottom-right) */}
              <div className="hidden sm:block absolute -bottom-7 -right-4 z-20 w-48 rounded-xl bg-[#FAF9F5] border border-[#E5E2D8] p-2.5 shadow-lg float-reverse">
                <img
                  src={STUDIO_MEDIA.catProductivity}
                  alt="Digital weekly study planner preview"
                  className="w-full h-24 object-cover rounded-lg border border-[#E5E2D8]"
                />
                <p className="mt-2 font-medium text-[11px] text-[#23242B]">
                  Weekly Planners &amp; Docs
                </p>
              </div>

              {/* Floating AI Deck Card (top-right) */}
              <div className="hidden md:flex items-center gap-2.5 absolute top-8 -right-8 z-20 rounded-xl bg-[#FAF9F5] border border-[#E5E2D8] px-3.5 py-2.5 shadow-md float-slow">
                <Sparkles className="w-4 h-4 text-[#E56B5D] shrink-0" />
                <div>
                  <p className="font-semibold text-[11px] text-[#23242B] whitespace-nowrap">
                    AI &amp; Prompt Decks
                  </p>
                  <p className="text-[10px] text-[#6B6A64] whitespace-nowrap">
                    Markdown + PDF Guides
                  </p>
                </div>
              </div>
            </div>

            <div
              ref={shadowRef}
              className="collage-shadow mt-6"
              aria-hidden="true"
            />
          </div>
        </div>
      </section>

      {/* 2. ANNOUNCEMENT TICKER (Live Admin Controlled) */}
      <div className="bg-[#23242B] text-[#FAF9F5] py-3.5 border-y border-[#E5E2D8] overflow-hidden marquee-wrapper">
        <div className="marquee-track items-center gap-8 text-xs md:text-sm font-medium tracking-wider uppercase">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center gap-8 pr-8 shrink-0">
              {(announcementParts.length > 0
                ? announcementParts
                : ['CREATE SMARTER', 'BUILD BETTER', 'WORK EFFICIENTLY', 'EXPLORE NEW IDEAS']
              ).map((phrase, idx) => (
                <div key={`${dup}-${idx}`} className="flex items-center gap-8">
                  <span>{phrase}</span>
                  <span aria-hidden="true" className="text-[#E56B5D]">
                    {idx % 2 === 0 ? '✦' : '◆'}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 3. FEATURED CATEGORIES */}
      <section id="categories" className="py-20 md:py-24 bg-[#FAF9F5]">
        <div className="max-w-[1360px] mx-auto px-5 md:px-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D] mb-2">
                Curated Disciplines
              </p>
              <h2 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B] [text-wrap:balance]">
                Find the tools for your next big idea.
              </h2>
            </div>
            <Link
              to="/books"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E56B5D] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Browse full catalog
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div
            ref={categoriesGridRef}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                to={`/books?category=${cat.id}`}
                className="reveal-tile group rounded-2xl border border-[#E5E2D8] p-5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-[#CFCBC0]"
                style={{ backgroundColor: cat.cardBg }}
              >
                <div>
                  <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EAE6DA] mb-5 border border-[#E5E2D8]">
                    <img
                      src={cat.image}
                      alt={cat.imageAlt}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  </div>
                  <h3 className="font-serif-editorial font-medium text-xl text-[#23242B] leading-snug">
                    {cat.name}
                  </h3>
                  <p className="text-sm text-[#6B6A64] mt-2 leading-relaxed">
                    {cat.shortDesc}
                  </p>
                </div>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#E56B5D]">
                  Explore category
                  <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 4. PINNED 4-STAGE SHOWCASE (Preserved GSAP ScrollTrigger Wipe Engine) */}
      <section ref={showcaseRef} id="showcase" className="showcase-pin">
        <div className="showcase-viewport">
          <div className="relative w-full h-full">
            {SHOWCASE_STAGES.map((stage, i) => (
              <figure
                key={stage.title}
                ref={(el) => {
                  frameRefs.current[i] = el;
                }}
                className={`showcase-frame${i === 0 ? ' is-active' : ''}`}
              >
                <img
                  src={stage.src}
                  alt={stage.alt}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </figure>
            ))}
          </div>

          <div className="absolute bottom-8 md:bottom-14 left-5 right-5 md:left-12 md:right-12 z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div
              className={`showcase-caption max-w-2xl text-[#FAF9F5]${
                captionBlur ? ' is-blurring' : ''
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-[#E56B5D] mb-2">
                {storefrontSettings.storeName} Flagship Preview
              </p>
              <h2 className="font-serif-editorial font-medium text-3xl sm:text-5xl md:text-6xl tracking-tight leading-none">
                {SHOWCASE_STAGES[activeStage].title}
              </h2>
              <p className="text-base md:text-xl text-white/85 mt-3 leading-relaxed">
                {SHOWCASE_STAGES[activeStage].sub}
              </p>
            </div>

            <div
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#1E1F24]/75 border border-white/20 backdrop-blur-md self-start md:self-auto"
              role="tablist"
              aria-label="Showcase stages"
            >
              {SHOWCASE_STAGES.map((stage, i) => (
                <button
                  key={stage.title}
                  type="button"
                  role="tab"
                  aria-selected={activeStage === i}
                  aria-label={`Stage ${i + 1}: ${stage.title}`}
                  onClick={() => selectStage(i)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    activeStage === i
                      ? 'w-11 bg-[#E56B5D]'
                      : 'w-6 bg-white/35 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. FEATURED PRODUCTS / POPULAR NOW */}
      <section className="py-20 md:py-24 bg-[#F3F1EA]">
        <div className="max-w-[1360px] mx-auto px-5 md:px-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D] mb-2">
                Featured Digital Tools
              </p>
              <h2 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B] [text-wrap:balance]">
                Useful tools. Ready when you are.
              </h2>
              <p className="text-sm text-[#6B6A64] mt-2">
                Instant digital downloads backed by verified order records.
              </p>
            </div>
            <Link
              to="/books"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold whitespace-nowrap shrink-0 btn-tactile"
            >
              Browse All Books
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>

      {/* 6. BRAND STORY SPLIT + 3D WIREFRAME CANVAS (Live Admin Copy) */}
      <section className="py-20 md:py-24 bg-[#FAF9F5]">
        <div className="max-w-[1360px] mx-auto px-5 md:px-10 grid grid-cols-1 lg:grid-cols-12 items-center gap-12">
          <div className="lg:col-span-6 space-y-6">
            <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D]">
              Our Philosophy
            </p>
            <h2 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B] leading-[1.06] [text-wrap:balance]">
              {storefrontSettings.storyTitle}
            </h2>
            <p className="text-base md:text-lg text-[#6B6A64] leading-relaxed">
              {storefrontSettings.storyBody}
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-4">
              <Link
                to="/about"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold btn-tactile"
              >
                Discover Our Story
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/product/solobiz-os"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#23242B] hover:text-[#E56B5D]"
              >
                Inspect SoloBiz OS ($9)
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Interactive 3D Rotating Architecture Wireframe */}
            <div className="mt-6 rounded-2xl border border-[#E5E2D8] bg-[#F3F1EA] p-5 grid grid-cols-1 sm:grid-cols-2 items-center gap-4">
              <div>
                <p className="font-serif-editorial font-medium text-base text-[#23242B]">
                  Modular System Architecture
                </p>
                <p className="text-xs text-[#6B6A64] mt-1 leading-relaxed">
                  Hover the wireframe to accelerate inspection. Every template
                  ships in clean, portable file formats you own outright.
                </p>
              </div>
              <div className="relative h-40 w-full">
                <canvas
                  ref={specsCanvasRef}
                  className="w-full h-full"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-5">
            <div className="rounded-2xl overflow-hidden border border-[#E5E2D8] bg-[#F3F1EA]">
              <img
                src={STUDIO_MEDIA.studioStory}
                alt="CraftedLabs sunlit studio desk with typography prints and layout tablets"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full aspect-[16/10] object-cover"
              />
            </div>
            <SoloBizInteractivePreview compact />
          </div>
        </div>
      </section>

      {/* 7. FREE RESOURCES */}
      <section id="free-resources" className="py-20 md:py-24 bg-[#EFECE2]">
        <div className="max-w-[1360px] mx-auto px-5 md:px-10">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D] mb-2">
              Free Starter Kit
            </p>
            <h2 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B] [text-wrap:balance]">
              A little something to get you started.
            </h2>
            <p className="text-base text-[#6B6A64] mt-3">
              Try our practical worksheets and checklists before you buy. Enter
              your email with clear consent to download any file instantly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FREE_RESOURCES.map((res) => (
              <article
                key={res.id}
                className="rounded-2xl border border-[#E5E2D8] p-5 flex flex-col justify-between"
                style={{ backgroundColor: res.cardBg }}
              >
                <div>
                  <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EAE6DA] mb-4 border border-[#E5E2D8]">
                    <img
                      src={res.image}
                      alt={res.imageAlt}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs mb-2">
                    <span className="text-[#6B6A64]">{res.format}</span>
                    <span className="font-mono-tabular font-bold text-[#E56B5D]">
                      Free
                    </span>
                  </div>
                  <h3 className="font-serif-editorial font-medium text-xl text-[#23242B]">
                    {res.title}
                  </h3>
                  <p className="text-sm text-[#6B6A64] mt-2 leading-relaxed">
                    {res.shortDesc}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveFreeResource(res)}
                  className="mt-6 w-full py-3 px-4 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold inline-flex items-center justify-center gap-2 btn-tactile cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 8. NEWSLETTER */}
      <section className="py-20 md:py-24 bg-[#FAF9F5]">
        <div className="max-w-[1000px] mx-auto px-5 md:px-10">
          <div className="rounded-3xl bg-[#F3F1EA] border border-[#E5E2D8] p-8 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-6 space-y-3">
              <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D]">
                The {storefrontSettings.storeName} Dispatch
              </p>
              <h2 className="font-serif-editorial font-medium text-3xl md:text-4xl tracking-tight text-[#23242B] [text-wrap:balance]">
                Get good things in your inbox.
              </h2>
              <p className="text-sm md:text-base text-[#6B6A64] leading-relaxed">
                New digital templates, honest launch notes, practical workflow
                tips, and occasional free downloads. Never spam, never sold.
              </p>
            </div>

            <form
              onSubmit={handleNewsletterSubmit}
              className="lg:col-span-6 space-y-3.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={nlFirstName}
                  onChange={(e) => setNlFirstName(e.target.value)}
                  placeholder="First name (optional)"
                  aria-label="First name (optional)"
                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
                <input
                  type="email"
                  required
                  value={nlEmail}
                  onChange={(e) => setNlEmail(e.target.value)}
                  placeholder="Email address"
                  aria-label="Email address"
                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#E5E2D8] text-sm text-[#23242B] focus:outline-none focus:border-[#23242B]"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-[#6B6A64] cursor-pointer leading-relaxed">
                <input
                  type="checkbox"
                  checked={nlConsent}
                  onChange={(e) => setNlConsent(e.target.checked)}
                  className="mt-0.5 accent-[#E56B5D]"
                />
                <span>
                  I agree to receive {storefrontSettings.storeName} emails in line
                  with the{' '}
                  <Link to="/legal/privacy" className="underline">
                    Privacy Policy
                  </Link>
                  . Unsubscribe in one click anytime.
                </span>
              </label>

              <button
                type="submit"
                className="w-full sm:w-auto px-7 py-3 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] text-sm font-semibold btn-tactile cursor-pointer"
              >
                Subscribe
              </button>

              {nlStatus === 'error' && (
                <p className="text-xs text-[#E56B5D] font-medium">{nlMessage}</p>
              )}
              {nlStatus === 'done' && (
                <p className="text-xs text-[#23242B] font-semibold inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#E56B5D]" />
                  {nlMessage}
                </p>
              )}
            </form>
          </div>
        </div>
      </section>

      {/* 9. BLOG / EDITORIAL */}
      <section className="py-20 md:py-24 bg-[#F3F1EA]">
        <div className="max-w-[1360px] mx-auto px-5 md:px-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-[#E56B5D] mb-2">
                Editorial Journal
              </p>
              <h2 className="font-serif-editorial font-medium text-3xl md:text-5xl tracking-tight text-[#23242B]">
                Ideas from the {storefrontSettings.storeName} desk.
              </h2>
            </div>
            <Link
              to="/blog"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E56B5D] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Read all articles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {blogArticles.slice(0, 3).map((article) => (
              <article
                key={article.id}
                className="group rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <Link
                    to={`/blog/${article.slug}`}
                    className="block aspect-[4/3] overflow-hidden bg-[#EAE6DA]"
                  >
                    <img
                      src={safeMediaUrl(article.image)}
                      alt={article.imageAlt}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  </Link>
                  <div className="p-6">
                    <div className="flex items-center gap-2 text-xs text-[#6B6A64] mb-2">
                      <span className="font-medium text-[#E56B5D]">
                        {article.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{article.readTime}</span>
                    </div>
                    <Link to={`/blog/${article.slug}`}>
                      <h3 className="font-serif-editorial font-medium text-xl text-[#23242B] group-hover:text-[#E56B5D] transition-colors leading-snug">
                        {article.title}
                      </h3>
                    </Link>
                    <p className="text-sm text-[#6B6A64] mt-2.5 leading-relaxed line-clamp-3">
                      {article.excerpt}
                    </p>
                  </div>
                </div>
                <div className="px-6 pb-6">
                  <Link
                    to={`/blog/${article.slug}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#23242B] hover:text-[#E56B5D]"
                  >
                    Read Article
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 10. FINAL CTA */}
      <section className="py-20 md:py-24 bg-[#FAF9F5] border-t border-[#E5E2D8]">
        <div className="max-w-[960px] mx-auto px-5 md:px-10 text-center space-y-6">
          <h2 className="font-serif-editorial font-medium text-3xl sm:text-5xl md:text-6xl tracking-tight text-[#23242B] [text-wrap:balance]">
            Ready to make your next move?
          </h2>
          <p className="text-base md:text-lg text-[#6B6A64] max-w-[46ch] mx-auto">
            Explore practical spreadsheets, templates, and creative guides built
            for calm, focused execution.
          </p>
          <div className="pt-2">
            <Link
              to="/books"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#23242B] hover:bg-[#32343D] text-[#FAF9F5] font-semibold text-base btn-tactile"
            >
              Browse Books &amp; Tools
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
