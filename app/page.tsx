import { interTight } from '@/lib/landing-fonts';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { Footer } from '@/components/landing/Footer';

export default function Home() {
  return (
    <div className={`lp ${interTight.variable}`}>
      {/* Without JS, keep reveal-on-scroll content visible. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: '.lp-reveal{opacity:1!important;transform:none!important}',
          }}
        />
      </noscript>

      <Header />
      <main>
        <Hero />
        <TrustStrip />
      </main>
      <Footer />
    </div>
  );
}
