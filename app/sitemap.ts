import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://www.tubermed.com/' },
    { url: 'https://www.tubermed.com/privacy' },
  ];
}
