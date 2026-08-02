import type { Metadata } from 'next';
import { interTight } from '@/lib/landing-fonts';
import { LenisProvider } from '@/components/landing/LenisProvider';
import { ScrollProgress } from '@/components/landing/ScrollProgress';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { Problem } from '@/components/landing/Problem';
import { Calculator } from '@/components/landing/Calculator';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { WhyTuberMed } from '@/components/landing/WhyTuberMed';
import { Comparison } from '@/components/landing/Comparison';
import { Marquee } from '@/components/landing/Marquee';
import { AuthorTrust } from '@/components/landing/AuthorTrust';
import { Security } from '@/components/landing/Security';
import { Pricing } from '@/components/landing/Pricing';
import { Faq } from '@/components/landing/Faq';
import { FinalCta } from '@/components/landing/FinalCta';
import { Footer } from '@/components/landing/Footer';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  alternates: { canonical: 'https://www.tubermed.com' },
};

export default function Home() {
  return (
    <div className={`lp ${interTight.variable}`}>
      <JsonLd />
      {/* Without JS, keep reveal-on-scroll content visible and every FAQ answer
          expanded — both carry inline collapsed styles (framer-motion's
          opacity:0, FaqItem's height:0), so these overrides need !important.
          The FAQ button is inert without JS, hence "always open" rather than
          "closed and unopenable". */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html:
              '[data-reveal]{opacity:1!important;transform:none!important}' +
              '.lp-faq-panel{height:auto!important;opacity:1!important}' +
              '.lp-faq-chev{transform:rotate(180deg)!important}',
          }}
        />
      </noscript>

      <LenisProvider />
      <ScrollProgress />
      <Header />
      <main>
        <Hero />
        <TrustStrip />
        <Problem />
        <Calculator />
        <HowItWorks />
        <WhyTuberMed />
        <Comparison />
        <Marquee />
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
