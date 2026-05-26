import React from 'react';
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 600 }}>OpenCodex</span>,
  project: {
    link: 'https://github.com/TODO-org/TODO-repo',
  },
  docsRepositoryBase: 'https://github.com/TODO-org/TODO-repo/tree/main/website',
  footer: {
    text: 'OpenCodex — MIT-licensed open-source desktop coding agent.',
  },
  useNextSeoProps() {
    return { titleTemplate: '%s — OpenCodex' };
  },
};

export default config;
