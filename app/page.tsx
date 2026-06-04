import { interTight } from '@/lib/landing-fonts';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { Problem } from '@/components/landing/Problem';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { WhyTuberMed } from '@/components/landing/WhyTuberMed';
import { AuthorTrust } from '@/components/landing/AuthorTrust';
import { Security } from '@/components/landing/Security';
import { Pricing } from '@/components/landing/Pricing';
import { Faq } from '@/components/landing/Faq';
import { FinalCta } from '@/components/landing/FinalCta';
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
        <Problem />
        <HowItWorks />
        <WhyTuberMed />
        <AuthorTrust />
        <Security />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
