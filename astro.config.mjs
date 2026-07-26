// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Deployed to GitHub Pages under a project subpath. Every internal link and
// asset must go through import.meta.env.BASE_URL (see src/lib/url.ts).
export default defineConfig({
  site: 'https://godtier812.github.io',
  base: '/Electrochemical-Cell-Simulator/',
  integrations: [mdx(), sitemap()],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [[rehypeKatex, { strict: false }]],
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      defaultColor: false,
    },
  },
});
