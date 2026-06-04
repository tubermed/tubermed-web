// Landing-only display font. Scoped here (not in the root layout) so Inter
// Tight is loaded + preloaded ONLY on the marketing pages that use it — the
// workspace/clinical app keeps its existing font payload unchanged.
//
// Brand wordmark + display headings: Inter Tight 700 ("Tuber" ink / "Med"
// accent), per the brand kit. 600 is included for sub-display weights.
import { Inter_Tight } from 'next/font/google';

export const interTight = Inter_Tight({
  subsets: ['latin', 'cyrillic'],
  weight: ['600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
});
