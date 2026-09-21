import { BrandLogo } from "../ui";

export function AuthIntro() {
  return (
    <section className="hidden lg:block animate-fade-up" aria-labelledby="auth-intro-title">
      <BrandLogo size="lg" className="mb-10" />
      <p className="label-caps mb-5 text-gold-400">Your private listening room</p>
      <h1
        id="auth-intro-title"
        className="max-w-xl font-serif text-5xl font-medium leading-[1.06] tracking-tight text-gradient xl:text-6xl"
      >
        Every story, performed.
      </h1>
      <p className="mt-6 max-w-lg text-base leading-relaxed text-cinema-400">
        Upload a DRM-free EPUB and let one warm narrator voice every character with director-guided emotion, chapter by chapter, as it is
        generated.
      </p>
      <div className="mt-10 flex items-center gap-4 text-xs text-cinema-400">
        <span className="h-px w-12 bg-gradient-to-r from-gold-400/70 to-transparent" />
        Private library · Seamless listening · Live studio
      </div>
    </section>
  );
}
