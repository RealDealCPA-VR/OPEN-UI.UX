import React from 'react';
import { useRouter } from 'next/router';
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 600 }}>opencodex-docs</span>,
  project: {
    link: 'https://github.com/RealDealCPA-VR/OPEN-UI.UX',
  },
  docsRepositoryBase: 'https://github.com/RealDealCPA-VR/OPEN-UI.UX/blob/main/website',
  footer: {
    text: 'opencodex-docs — MIT-licensed open-source desktop coding agent.',
  },
  useNextSeoProps() {
    const { asPath } = useRouter();
    const isLanding = asPath === '/' || asPath === '/index';
    return {
      titleTemplate: isLanding ? 'opencodex-docs' : '%s — opencodex-docs',
      description:
        'opencodex-docs — Mission Control for AI coding agents. Local-first, MIT-licensed, provider-agnostic Electron desktop app.',
    };
  },
};

export default config;
