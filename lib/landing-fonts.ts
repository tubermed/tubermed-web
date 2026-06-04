// Landing-only display font. Scoped here (not in the root layout) so Inter
// Tight is loaded + preloaded ONLY on the marketing pages that use it — the
// workspace/clinical app keeps its existing font payload unchanged.
//
// Brand wordmark + display headings: Inter Tight 700 ("Tuber" ink / "Med"
// accent), per the brand kit. 600 is included for sub-display weights.
import { Inter_Tight, Golos_Text } from 'next/font/google';

export const interTight = Inter_Tight({
  subsets: ['latin', 'cyrillic'],
  weight: ['600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
});

// In-mock body font for the hero product walkthrough (good Cyrillic).
// Loaded via next/font so it is SELF-HOSTED at build time — NO runtime request
// to Google Fonts (which would leak the visitor's IP to the US and contradict
// the page's own EU/no-US-transfer promise). Landing-only.
export const golosText = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-golos',
  display: 'swap',
});
