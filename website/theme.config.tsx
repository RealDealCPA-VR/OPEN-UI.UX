import React from 'react';
import { useRouter } from 'next/router';
import type { DocsThemeConfig } from 'nextra-theme-docs';

/** Brand mark — luminous indigo square with an 'O' cut-out. */
const LogoMark = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ display: 'block', flexShrink: 0 }}
  >
    <rect width="22" height="22" rx="6" fill="var(--accent-bg, #5e5ce6)" />
    <path
      d="M11 6a5 5 0 1 0 0 10A5 5 0 0 0 11 6zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
      fill="var(--accent-on-bg, #ffffff)"
    />
  </svg>
);

const Logo = () => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
    }}
  >
    <LogoMark />
    <span
      style={{
        fontWeight: 600,
        fontSize: '15px',
        letterSpacing: '-0.02em',
        color: 'var(--text-primary, inherit)',
      }}
    >
      OpenCodex
    </span>
  </span>
);

const config: DocsThemeConfig = {
  logo: <Logo />,
  project: {
    link: 'https://github.com/RealDealCPA-VR/OPEN-UI.UX',
  },
  docsRepositoryBase: 'https://github.com/RealDealCPA-VR/OPEN-UI.UX/blob/main/website',
  footer: {
    text: 'OpenCodex — MIT-licensed open-source desktop coding agent.',
  },
  useNextSeoProps() {
    const { asPath } = useRouter();
    const isLanding = asPath === '/' || asPath === '/index';
    return {
      titleTemplate: isLanding ? 'OpenCodex' : '%s — OpenCodex',
      description:
        'OpenCodex — Mission Control for AI coding agents. Local-first, MIT-licensed, provider-agnostic Electron desktop app.',
    };
  },
};

export default config;
