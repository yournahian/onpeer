/**
 * Edge SEO, AEO (Answer Engine Optimization — Schema.org JSON-LD),
 * and GEO (Generative Engine Optimization — llms.txt / llms-full.txt / AI crawlers)
 * for onpeer.xyz, app.onpeer.xyz, and docs.onpeer.xyz.
 */

const LANDING_ORIGIN = 'https://onpeer.xyz'
const APP_ORIGIN = 'https://app.onpeer.xyz'
const DOCS_ORIGIN = 'https://docs.onpeer.xyz'

export const OG_IMAGE_URL = `${LANDING_ORIGIN}/brand/open-graph-1200x630.png?v=2`
export const LOGO_SQUARE_URL = `${LANDING_ORIGIN}/brand/onpeer-logo-orange-1024.png`
export const TWITTER_HANDLE = '@onpeerapp'

interface PageSeoMeta {
  title: string
  description: string
  canonicalUrl: string
  ogType: 'website' | 'article'
  robots: string
  keywords: string
  jsonLd: Record<string, unknown>
}

interface DocSlugMeta {
  slug: string
  title: string
  description: string
  section: string
}

const DOC_SLUGS: DocSlugMeta[] = [
  {
    slug: 'introduction',
    title: 'Introduction to OnPeer | Non-Custodial P2P Crypto, Swap & Bridge on Arc',
    description:
      'Architecture overview of OnPeer v2.1: zero-fee non-custodial P2P escrow for USDC, EURC, cirBTC & WETH across 8 South Asian fiat corridors, Circle Swap Kit, and CCTP/CCTPx bridging on Arc.',
    section: 'Getting Started',
  },
  {
    slug: 'quickstart',
    title: 'Quickstart Guide | Connect Wallet, Swap, Bridge & Trade P2P — OnPeer Docs',
    description:
      'Step-by-step quickstart to connect an EVM wallet on Arc Testnet (Chain ID 5042002), pay gas in native USDC, and complete your first P2P escrow order, token swap, or cross-chain bridge.',
    section: 'Getting Started',
  },
  {
    slug: 'arc-network',
    title: 'Arc Network & Native USDC Gas | Sub-Second Finality — OnPeer Docs',
    description:
      'How OnPeer leverages Arc (Circle Layer-1 blockchain) where USDC is the native gas token with predictable cent-level fees and sub-second deterministic finality.',
    section: 'Getting Started',
  },
  {
    slug: 'p2p-marketplace',
    title: 'P2P Marketplace & Multi-Asset Trading (USDC, EURC, cirBTC, WETH) — OnPeer Docs',
    description:
      'Trade USDC, EURC, cirBTC, and WETH peer-to-peer across BDT, INR, PKR, LKR, NPR, BTN, MVR, and AFN with bKash, Nagad, Rocket, UPI, IMPS, Raast, JazzCash, and local bank transfers.',
    section: 'Core Products',
  },
  {
    slug: 'escrow',
    title: 'P2PEscrow v2.1 Smart Contract Architecture & Rules — OnPeer Docs',
    description:
      'Deep dive into P2PEscrow v2.1: 0% trade fee, $0.05 flat ad listing fee, decimal-aware math (6d/8d/18d), tiered order caps, 5-minute late payment recovery window, and merchant security margin.',
    section: 'Core Products',
  },
  {
    slug: 'swap-and-bridge',
    title: 'Token Swap & Cross-Chain Bridge (Circle CCTP v2 & CCTPx) — OnPeer Docs',
    description:
      'Swap between USDC, EURC, cirBTC, and WETH on Arc and bridge natively across Ethereum, Base, Arbitrum, Optimism, Polygon, and Avalanche via Circle CCTP v2 and CCTPx.',
    section: 'Core Products',
  },
  {
    slug: 'kyc-and-vault',
    title: 'Didit KYC Verification & AES-256-GCM Encrypted Payment Vault — OnPeer Docs',
    description:
      'How OnPeer protects bank and mobile-money account numbers off-chain with AES-256-GCM envelope encryption, on-chain keccak256 hash binding, and Didit identity verification.',
    section: 'Trust, Safety & Disputes',
  },
  {
    slug: 'disputes',
    title: 'Dispute Resolution, 30m Cooling-Off & Asymmetric Bonds — OnPeer Docs',
    description:
      'Understand OnPeer dispute resolution: zero upfront wallet balance to open a dispute, 30-minute penalty-free cooling-off settlement, 2-phone raw video evidence, and FIFO bond debt.',
    section: 'Trust, Safety & Disputes',
  },
  {
    slug: 'contracts',
    title: 'Deployed Smart Contracts & Token Addresses on Arc Testnet — OnPeer Docs',
    description:
      'Verified contract addresses on Arc Testnet (Chain ID 5042002) for P2PEscrow v2.1 (USDC, EURC, cirBTC, WETH), ERC-20 tokens, Circle CCTPx router, and KYC verifier.',
    section: 'Developers & Reference',
  },
  {
    slug: 'security-and-api',
    title: 'Security Model, Strict CSP & Cloudflare Worker API Reference — OnPeer Docs',
    description:
      'Security architecture of OnPeer: non-custodial funds, strict Content-Security-Policy, wallet-signature authentication, prompt-injection hygiene, and REST API endpoints.',
    section: 'Developers & Reference',
  },
]

const CORE_FAQS = [
  {
    question: 'What is OnPeer?',
    answer:
      'OnPeer is a non-custodial peer-to-peer (P2P) crypto marketplace, token swap, and cross-chain bridge built on Arc (Circle Layer-1 blockchain) for South Asia. Users trade USDC, EURC, cirBTC, and WETH directly against BDT, INR, PKR, LKR, NPR, BTN, MVR, and AFN with smart contract escrow.',
  },
  {
    question: 'Which cryptocurrencies and South Asian fiat payment methods does OnPeer support?',
    answer:
      'OnPeer supports four cryptocurrencies — USDC (6 decimals), EURC (6 decimals), cirBTC (8 decimals), and WETH (18 decimals) — across 8 South Asian fiat currencies: BDT (bKash, Nagad, Rocket, Bank Transfer), INR (UPI, IMPS, Paytm, Bank Transfer), PKR (Raast, JazzCash, Easypaisa), LKR (LankaQR, Bank Transfer), NPR (eSewa, Khalti), BTN (mBoB), MVR (BML Transfer), and AFN.',
  },
  {
    question: 'What are the trading and escrow fees on OnPeer?',
    answer:
      'OnPeer charges 0% platform fee on P2P trades, ad refreshes, encrypted order chat, and dispute settlements. Posting a new Buy or Sell ad has a flat ~$0.05 equivalent listing fee paid on-chain to prevent order-book spam.',
  },
  {
    question: 'How does OnPeer keep P2P trades and payment account details safe?',
    answer:
      'Crypto is locked in audited, non-custodial P2PEscrow v2.1 smart contracts on Arc — OnPeer never holds user funds. Payment account numbers are encrypted off-chain with AES-256-GCM in the OnPeer Vault (bound on-chain via keccak256 hash) and revealed only to active order counterparties, backed by Didit KYC name-match verification and strict anti-third-party transfer rules.',
  },
  {
    question: 'How does cross-chain bridging work on OnPeer?',
    answer:
      'OnPeer uses Circle CCTP v2 for native burn-and-mint USDC transfers and Circle CCTPx with Fast and Standard finality modes for EURC, cirBTC, and WETH across Arc, Ethereum, Base, Arbitrum, Optimism, Polygon, and Avalanche — with zero wrapped-bridge liquidity pool risk.',
  },
  {
    question: 'Which blockchain does OnPeer run on and what token pays for gas?',
    answer:
      'OnPeer runs on Arc (Chain ID 5042002 on Arc Testnet), Circle Layer-1 EVM blockchain where USDC is the native gas token. Users never need ETH or a separate volatile gas token to approve, escrow, swap, or bridge.',
  },
]

function baseOrganizationGraph() {
  return [
    {
      '@type': 'Organization',
      '@id': `${LANDING_ORIGIN}/#organization`,
      name: 'OnPeer',
      url: LANDING_ORIGIN,
      logo: {
        '@type': 'ImageObject',
        url: LOGO_SQUARE_URL,
        width: 1024,
        height: 1024,
      },
      image: OG_IMAGE_URL,
      description:
        'Non-custodial P2P crypto marketplace, swap, and Circle CCTP/CCTPx cross-chain bridge for South Asia built on Arc.',
      sameAs: ['https://x.com/onpeerapp', APP_ORIGIN, DOCS_ORIGIN],
      areaServed: ['BD', 'IN', 'PK', 'LK', 'NP', 'BT', 'MV', 'AF'],
    },
    {
      '@type': 'WebSite',
      '@id': `${LANDING_ORIGIN}/#website`,
      url: LANDING_ORIGIN,
      name: 'OnPeer',
      publisher: { '@id': `${LANDING_ORIGIN}/#organization` },
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${DOCS_ORIGIN}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'WebApplication',
      '@id': `${APP_ORIGIN}/#webapp`,
      name: 'OnPeer App',
      url: APP_ORIGIN,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      browserRequirements: 'Requires JavaScript and an EVM Web3 wallet (MetaMask, Rabby, WalletConnect).',
      provider: { '@id': `${LANDING_ORIGIN}/#organization` },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: '0% P2P taker/maker trade fee; ~$0.05 flat per-ad listing fee on Arc.',
      },
      featureList: [
        'Non-custodial P2P smart contract escrow for USDC, EURC, cirBTC, and WETH',
        '8 South Asian fiat corridors: BDT, INR, PKR, LKR, NPR, BTN, MVR, AFN',
        'Instant token swaps on Arc via Circle Swap Kit',
        'Native cross-chain USDC, EURC, cirBTC & WETH bridging via Circle CCTP v2 and CCTPx',
        'AES-256-GCM encrypted payment details vault with on-chain keccak256 hash verification',
        'Didit KYC verification and 30-minute penalty-free dispute cooling-off window',
      ],
    },
  ]
}

function faqSchemaNode() {
  return {
    '@type': 'FAQPage',
    '@id': `${LANDING_ORIGIN}/#faq`,
    mainEntity: CORE_FAQS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

export function resolvePageSeo(url: URL): PageSeoMeta {
  const host = url.hostname.toLowerCase()
  const rawPath = url.pathname.replace(/\/+$/, '') || '/'
  const defaultKeywords =
    'OnPeer, P2P USDC South Asia, Buy Sell USDC BDT bKash Nagad, P2P INR UPI, P2P PKR Raast, EURC P2P, cirBTC, WETH, Arc blockchain, Circle CCTP bridge, CCTPx, non-custodial P2P crypto escrow'

  // 1. Documentation Subdomain (docs.onpeer.xyz) or /docs path
  if (host === 'docs.onpeer.xyz' || rawPath === '/docs' || rawPath.startsWith('/docs/')) {
    const slugRaw =
      host === 'docs.onpeer.xyz'
        ? rawPath.replace(/^\/+/, '')
        : rawPath.replace(/^\/docs\/?/, '')
    const matched = DOC_SLUGS.find((d) => d.slug === slugRaw) ?? DOC_SLUGS[0]!
    const isRoot = !slugRaw || slugRaw === 'introduction'
    const canonicalUrl = isRoot ? `${DOCS_ORIGIN}/` : `${DOCS_ORIGIN}/${matched.slug}`

    return {
      title: isRoot
        ? 'OnPeer Documentation | P2P Escrow, Swap, CCTPx Bridge & Arc Smart Contracts'
        : matched.title,
      description: matched.description,
      canonicalUrl,
      ogType: 'article',
      robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
      keywords: `${defaultKeywords}, OnPeer documentation, P2PEscrow v2.1, ${matched.section}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          ...baseOrganizationGraph(),
          {
            '@type': 'TechArticle',
            headline: matched.title,
            description: matched.description,
            url: canonicalUrl,
            image: OG_IMAGE_URL,
            author: { '@id': `${LANDING_ORIGIN}/#organization` },
            publisher: { '@id': `${LANDING_ORIGIN}/#organization` },
            articleSection: matched.section,
            inLanguage: 'en',
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'OnPeer', item: LANDING_ORIGIN },
              { '@type': 'ListItem', position: 2, name: 'Documentation', item: `${DOCS_ORIGIN}/` },
              ...(isRoot
                ? []
                : [{ '@type': 'ListItem', position: 3, name: matched.title, item: canonicalUrl }]),
            ],
          },
          ...(isRoot ? [faqSchemaNode()] : []),
        ],
      },
    }
  }

  // 2. App Subdomain (app.onpeer.xyz) or App Routes
  if (host === 'app.onpeer.xyz' || rawPath !== '/') {
    if (rawPath === '/admin' || rawPath.startsWith('/admin/')) {
      return {
        title: 'Admin Control Room | OnPeer',
        description: 'Owner and arbiter dispute resolution control room for OnPeer P2PEscrow.',
        canonicalUrl: `${APP_ORIGIN}/admin`,
        ogType: 'website',
        robots: 'noindex, nofollow',
        keywords: defaultKeywords,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/privacy') {
      return {
        title: 'Privacy & Vault Encryption Notice | OnPeer',
        description:
          'How OnPeer encrypts P2P payment details, chat messages, and dispute evidence with AES-256-GCM, Didit KYC verification, and automated retention.',
        canonicalUrl: `${LANDING_ORIGIN}/privacy`,
        ogType: 'website',
        robots: 'index, follow',
        keywords: `${defaultKeywords}, OnPeer privacy policy, AES-256-GCM vault`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/swap') {
      return {
        title: 'Swap USDC, EURC, cirBTC & WETH on Arc | OnPeer',
        description:
          'Swap instantaneously between USDC, EURC, cirBTC, and WETH on Arc with Circle Swap Kit, deterministic finality, and native USDC gas.',
        canonicalUrl: `${APP_ORIGIN}/swap`,
        ogType: 'website',
        robots: 'index, follow, max-image-preview:large',
        keywords: `${defaultKeywords}, Swap USDC EURC cirBTC WETH Arc`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/bridge') {
      return {
        title: 'Bridge USDC, EURC, cirBTC & WETH Across Chains (CCTP & CCTPx) | OnPeer',
        description:
          'Bridge USDC via Circle CCTP v2 and EURC, cirBTC, and WETH via Circle CCTPx between Arc, Ethereum, Base, Arbitrum, Optimism, Polygon, and Avalanche.',
        canonicalUrl: `${APP_ORIGIN}/bridge`,
        ogType: 'website',
        robots: 'index, follow, max-image-preview:large',
        keywords: `${defaultKeywords}, Bridge USDC CCTP, Bridge EURC cirBTC WETH CCTPx`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/buy') {
      return {
        title: 'Buy USDC with Card, Apple Pay & Bank Transfer | OnPeer Fiat Onramp',
        description:
          'Buy USDC straight into your self-custody wallet via Circle Onramp, then swap, bridge, or trade P2P across South Asia.',
        canonicalUrl: `${APP_ORIGIN}/buy`,
        ogType: 'website',
        robots: 'index, follow, max-image-preview:large',
        keywords: `${defaultKeywords}, Buy USDC card Apple Pay, Circle Onramp`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/assistant') {
      return {
        title: 'AI Trading, Swap & Bridge Assistant | OnPeer',
        description:
          'Check live P2P rates, wallet balances, swaps, and cross-chain bridges in plain language with non-custodial wallet confirmation.',
        canonicalUrl: `${APP_ORIGIN}/assistant`,
        ogType: 'website',
        robots: 'index, follow, max-image-preview:large',
        keywords: `${defaultKeywords}, OnPeer AI assistant, DeFi copilot`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    if (rawPath === '/brand-kit') {
      return {
        title: 'Brand Kit & Official Media Assets | OnPeer',
        description: 'Official OnPeer logos, marks, color palette, and brand guidelines.',
        canonicalUrl: `${LANDING_ORIGIN}/brand-kit`,
        ogType: 'website',
        robots: 'index, follow',
        keywords: `${defaultKeywords}, OnPeer logo, OnPeer brand kit`,
        jsonLd: { '@context': 'https://schema.org', '@graph': baseOrganizationGraph() },
      }
    }

    // Default App / P2P Marketplace route (/p2p or app.onpeer.xyz/)
    const tradeId = url.searchParams.get('trade')
    const trader = url.searchParams.get('trader')
    const p2pTitle =
      tradeId && /^\d+$/.test(tradeId)
        ? `P2P Offer #${tradeId} — Buy & Sell Crypto on Arc Escrow | OnPeer`
        : trader && /^0x[0-9a-fA-F]{40}$/.test(trader)
          ? `Verified Trader ${trader.slice(0, 6)}...${trader.slice(-4)} | OnPeer P2P`
          : 'OnPeer P2P Marketplace | Buy & Sell USDC, EURC, cirBTC & WETH in South Asia'

    return {
      title: p2pTitle,
      description:
        'Trade USDC, EURC, cirBTC, and WETH peer-to-peer with BDT, INR, PKR, LKR, NPR, BTN, MVR & AFN using bKash, Nagad, Rocket, UPI, Raast & bank transfer. 0% trade fee on Arc smart contract escrow.',
      canonicalUrl: `${APP_ORIGIN}/p2p`,
      ogType: 'website',
      robots: 'index, follow, max-snippet:-1, max-image-preview:large',
      keywords: defaultKeywords,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [...baseOrganizationGraph(), faqSchemaNode()],
      },
    }
  }

  // 3. Primary Landing Page (https://onpeer.xyz/)
  return {
    title: 'OnPeer | P2P USDC, EURC, cirBTC & WETH, Swap & Bridge for South Asia on Arc',
    description:
      'Non-custodial P2P crypto marketplace for South Asia on Arc. Buy & sell USDC, EURC, cirBTC & WETH with BDT, INR, PKR, LKR & NPR at 0% trade fee, plus instant swaps and Circle CCTP/CCTPx bridging.',
    canonicalUrl: `${LANDING_ORIGIN}/`,
    ogType: 'website',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    keywords: defaultKeywords,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [...baseOrganizationGraph(), faqSchemaNode()],
    },
  }
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function injectSeoHtml(html: string, url: URL): string {
  const meta = resolvePageSeo(url)
  const titleEsc = escapeHtmlAttr(meta.title)
  const descEsc = escapeHtmlAttr(meta.description)
  const canonEsc = escapeHtmlAttr(meta.canonicalUrl)
  const robotsEsc = escapeHtmlAttr(meta.robots)
  const keywordsEsc = escapeHtmlAttr(meta.keywords)

  const seoBlock = [
    `<title>${titleEsc}</title>`,
    `<meta name="description" content="${descEsc}" />`,
    `<meta name="keywords" content="${keywordsEsc}" />`,
    `<meta name="robots" content="${robotsEsc}" />`,
    `<meta name="author" content="OnPeer" />`,
    `<meta name="application-name" content="OnPeer" />`,
    `<link rel="canonical" href="${canonEsc}" />`,
    `<link rel="alternate" type="text/plain" title="LLMs Summary" href="${LANDING_ORIGIN}/llms.txt" />`,
    `<link rel="alternate" type="text/plain" title="LLMs Full Documentation" href="${LANDING_ORIGIN}/llms-full.txt" />`,
    `<meta property="og:site_name" content="OnPeer" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:url" content="${canonEsc}" />`,
    `<meta property="og:title" content="${titleEsc}" />`,
    `<meta property="og:description" content="${descEsc}" />`,
    `<meta property="og:image" content="${OG_IMAGE_URL}" />`,
    `<meta property="og:image:secure_url" content="${OG_IMAGE_URL}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="OnPeer — Non-Custodial P2P Crypto, Swap & Bridge for South Asia on Arc" />`,
    `<meta property="og:logo" content="${LOGO_SQUARE_URL}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${TWITTER_HANDLE}" />`,
    `<meta name="twitter:creator" content="${TWITTER_HANDLE}" />`,
    `<meta name="twitter:domain" content="${escapeHtmlAttr(url.hostname)}" />`,
    `<meta name="twitter:url" content="${canonEsc}" />`,
    `<meta name="twitter:title" content="${titleEsc}" />`,
    `<meta name="twitter:description" content="${descEsc}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE_URL}" />`,
    `<meta name="twitter:image:src" content="${OG_IMAGE_URL}" />`,
    `<meta name="twitter:image:alt" content="OnPeer — Non-Custodial P2P Crypto, Swap & Bridge for South Asia on Arc" />`,
    `<script id="onpeer-jsonld" type="application/ld+json">${safeJsonLd(meta.jsonLd)}</script>`,
  ].join('\n    ')

  // Strip existing static SEO/OG/Twitter/JSON-LD tags from index.html before injecting fresh edge tags
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+name="(?:description|keywords|robots|author|application-name|twitter:[^"]+)"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:[^"]+"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="(?:canonical|alternate)"[^>]*>\s*/gi, '')
    .replace(/<script\s+id="onpeer-jsonld"[\s\S]*?<\/script>\s*/gi, '')

  if (cleaned.includes('<!-- ONPEER_SEO_SLOT -->')) {
    return cleaned.replace('<!-- ONPEER_SEO_SLOT -->', seoBlock)
  }
  return cleaned.replace('</head>', `    ${seoBlock}\n  </head>`)
}

export async function injectSeoIntoHtmlResponse(res: Response, url: URL): Promise<Response> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.toLowerCase().includes('text/html')) return res
  const html = await res.text()
  const rewritten = injectSeoHtml(html, url)
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('etag')
  return new Response(rewritten, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

export function buildRobotsTxt(): string {
  return [
    '# OnPeer — Search Engine, Social Card & AI Answer Engine Policy',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    '',
    '# Explicitly welcome AI Search, Answer & Generative Engines (GEO / AEO)',
    'User-agent: GPTBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: Applebot-Extended',
    'Allow: /',
    '',
    'User-agent: Twitterbot',
    'Allow: /',
    '',
    'User-agent: facebookexternalhit',
    'Allow: /',
    '',
    `Sitemap: ${LANDING_ORIGIN}/sitemap.xml`,
    `Sitemap: ${DOCS_ORIGIN}/sitemap.xml`,
    '',
    `# LLMs Context (https://llmstxt.org)`,
    `# ${LANDING_ORIGIN}/llms.txt`,
    `# ${LANDING_ORIGIN}/llms-full.txt`,
    '',
  ].join('\n')
}

export function buildSitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10)
  const urls: { loc: string; priority: string; changefreq: string }[] = [
    { loc: `${LANDING_ORIGIN}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${LANDING_ORIGIN}/privacy`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${LANDING_ORIGIN}/brand-kit`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${APP_ORIGIN}/p2p`, priority: '0.95', changefreq: 'hourly' },
    { loc: `${APP_ORIGIN}/swap`, priority: '0.9', changefreq: 'daily' },
    { loc: `${APP_ORIGIN}/bridge`, priority: '0.9', changefreq: 'daily' },
    { loc: `${APP_ORIGIN}/buy`, priority: '0.85', changefreq: 'weekly' },
    { loc: `${APP_ORIGIN}/assistant`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${DOCS_ORIGIN}/`, priority: '0.95', changefreq: 'weekly' },
    ...DOC_SLUGS.filter((d) => d.slug !== 'introduction').map((d) => ({
      loc: `${DOCS_ORIGIN}/${d.slug}`,
      priority: '0.85',
      changefreq: 'weekly',
    })),
  ]

  const items = urls
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>
`
}

export const LLMS_TXT = `# OnPeer

> Non-custodial peer-to-peer (P2P) crypto marketplace, instant token swap, and cross-chain bridge for South Asia built on Arc (Circle's Layer-1 blockchain where USDC is the native gas token).

OnPeer enables users across Bangladesh, India, Pakistan, Sri Lanka, Nepal, Bhutan, Maldives, and Afghanistan to buy and sell **USDC**, **EURC**, **cirBTC**, and **WETH** directly using local payment rails (bKash, Nagad, Rocket, UPI, IMPS, Paytm, Raast, JazzCash, Easypaisa, LankaQR, eSewa, Khalti, mBoB, BML, and bank transfers) protected by non-custodial smart contract escrow (\`P2PEscrow v2.1\`) with **0% trading fees**.

## Canonical Domains

- [Landing Website](https://onpeer.xyz/): Product overview, regional corridors, and protocol highlights.
- [Web Application](https://app.onpeer.xyz/p2p): Live P2P marketplace, Swap, Bridge, and AI Assistant.
- [Documentation Portal](https://docs.onpeer.xyz/): Complete protocol architecture, smart contract rules, CCTPx routes, and security reference.
- [Full LLM Reference](https://onpeer.xyz/llms-full.txt): Single-file comprehensive technical specification for AI assistants and answer engines.

## Core Products

- [P2P Marketplace](https://app.onpeer.xyz/p2p): Non-custodial Buy & Sell orderbook for \`USDC\`, \`EURC\`, \`cirBTC\`, and \`WETH\` across 8 South Asian fiat currencies (\`BDT\`, \`INR\`, \`PKR\`, \`LKR\`, \`NPR\`, \`BTN\`, \`MVR\`, \`AFN\`).
- [Token Swap](https://app.onpeer.xyz/swap): Permissionless swaps among \`USDC\`, \`EURC\`, \`cirBTC\`, and \`WETH\` on Arc via Circle Swap Kit.
- [Cross-Chain Bridge](https://app.onpeer.xyz/bridge): Native \`USDC\` bridging via Circle CCTP v2 and \`EURC\`, \`cirBTC\`, \`WETH\` bridging via Circle CCTPx (\`FAST\` and \`SLOW\` modes).

## Documentation Pages

- [Introduction](https://docs.onpeer.xyz/): Protocol overview and design principles.
- [Quickstart Guide](https://docs.onpeer.xyz/quickstart): Wallet setup on Arc Testnet (Chain ID \`5042002\`) and first trade.
- [Arc Network & Gas](https://docs.onpeer.xyz/arc-network): Native USDC gas and sub-second deterministic finality.
- [P2P Marketplace](https://docs.onpeer.xyz/p2p-marketplace): Supported crypto assets, fiat corridors, and auto-filled payment methods.
- [Escrow Smart Contract](https://docs.onpeer.xyz/escrow): \`P2PEscrow v2.1\` state machine, 0% trade fee, tiered caps, and merchant margin.
- [Swap & Bridge (CCTP / CCTPx)](https://docs.onpeer.xyz/swap-and-bridge): Multi-token swaps and cross-chain routes.
- [KYC & Encrypted Vault](https://docs.onpeer.xyz/kyc-and-vault): Didit identity verification and AES-256-GCM payment vault.
- [Dispute Resolution](https://docs.onpeer.xyz/disputes): 30-minute cooling-off, 2-phone video proof, and asymmetric bonds.
- [Deployed Contracts](https://docs.onpeer.xyz/contracts): Verified contract and token addresses on Arc Testnet.
- [Security & API Reference](https://docs.onpeer.xyz/security-and-api): Non-custodial guarantees, CSP, and Worker endpoints.
`

export const LLMS_FULL_TXT = `# OnPeer — Full Technical & Product Reference (GEO / LLM Context)

> Canonical URLs: https://onpeer.xyz | https://app.onpeer.xyz | https://docs.onpeer.xyz
> Official X (Twitter): https://x.com/onpeerapp (@onpeerapp)
> Network: Arc Testnet (Chain ID: 5042002, Native Gas Token: USDC)

## 1. Executive Summary

OnPeer is a non-custodial peer-to-peer (P2P) crypto marketplace, swap terminal, and cross-chain bridge built on **Arc** (Circle's EVM Layer-1 blockchain where USDC is the native gas token). OnPeer is purpose-built for South Asian fiat corridors where users rely on instant mobile-money and real-time banking rails.

### Key Facts at a Glance
- **Custody Model:** 100% non-custodial smart contract escrow (\`P2PEscrow.sol\` v2.1, Solidity 0.8.28). OnPeer operators and backend workers cannot move or freeze escrowed user funds.
- **Supported Cryptocurrencies (P2P, Swap & Bridge):**
  1. \`USDC\` — 6 decimals (\`0x3600000000000000000000000000000000000000\`)
  2. \`EURC\` — 6 decimals (\`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a\`)
  3. \`cirBTC\` — 8 decimals (\`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF\`)
  4. \`WETH\` — 18 decimals (\`0x2c4047028a72803939b6fb674D01bC059B5C4961\`)
- **Supported South Asian Fiat Currencies (8 Corridors):**
  - **Bangladesh (\`BDT\`, ৳):** bKash, Nagad, Rocket, Bank Transfer
  - **India (\`INR\`, ₹):** UPI, IMPS, Paytm, Bank Transfer
  - **Pakistan (\`PKR\`, ₨):** Raast, JazzCash, Easypaisa, Bank Transfer
  - **Sri Lanka (\`LKR\`, Rs):** LankaQR, Bank Transfer
  - **Nepal (\`NPR\`, Rs):** eSewa, Khalti, Bank Transfer
  - **Bhutan (\`BTN\`, Nu.):** mBoB, Bank Transfer
  - **Maldives (\`MVR\`, Rf):** BML Transfer, Bank Transfer
  - **Afghanistan (\`AFN\`, ؋):** HesabPay, Bank Transfer
- **Fee Schedule:**
  - **P2P Trade Fee (Maker & Taker):** \`0%\` (free)
  - **Ad Refresh, Chat & Dispute Filing:** \`0%\` (free)
  - **Ad Listing Fee:** Flat ~\`$0.05\` equivalent per new ad (\`0.05 USDC\`, \`0.05 EURC\`, \`0.00000050 cirBTC\`, or \`0.00002 WETH\`) to prevent order-book spam.

## 2. Deployed Smart Contracts on Arc Testnet (Chain ID: 5042002)

| Contract | Address | Deploy Block | Purpose |
| --- | --- | --- | --- |
| \`P2PEscrow\` (\`USDC\`) | \`0x7f661625bC08d72E156A206ee8D24022D7463350\` | \`74250625\` | Primary USDC P2P escrow contract (v2.3) |
| \`P2PEscrow\` (\`EURC\`) | \`0x26Ef2B69AC928457E348BeEd72Bf116dB81438B9\` | \`74250630\` | Euro Coin (EURC) P2P escrow contract (v2.3) |
| \`P2PEscrow\` (\`cirBTC\`) | \`0x6ba3b81833b6354f08483740211af3ddda396b39\` | \`73734225\` | 8-decimal cirBTC P2P escrow contract |
| \`P2PEscrow\` (\`WETH\`) | \`0xbd79693411ee47e2acbba14e9353e7e0c43bf6f3\` | \`73734238\` | 18-decimal Wrapped Ether (WETH) P2P escrow contract |
| \`CrossChainTokenService\` | \`0x63753E722bd2C2A5DF6EE19C5106662208B81077\` | — | Circle CCTPx cross-chain router on Arc Testnet (Domain 26) |
| KYC Verifier Wallet | \`0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e\` | — | Attests Didit KYC level on-chain; zero custody power |

## 3. P2PEscrow v2.1 Safety Mechanics

1. **Fixed Price Slippage Guard:** \`openOrder\` verifies \`expectedPriceE6\` on-chain so a maker cannot front-run a rate change while a taker signs.
2. **5-Minute Late Payment Recovery Window:** If a buyer sends fiat just before the countdown expires, they have a hidden 5-minute grace period to submit their bank/mobile-money transfer ID (\`payerProof != 0\`, capped at 2 late marks per 30 days) so honest buyers never lose funds to clock skew.
3. **Strict Anti-Third-Party & Name-Match Policy:** Counterparties must pay and receive strictly from accounts matching their verified identity. Pinned chat warnings and release modals enforce that third-party transfers must never be sent or released.
4. **AES-256-GCM Encrypted Payment Vault:** Receiving account numbers, order chat messages, and dispute evidence (images/PDFs) are sealed off-chain with per-record AES-256-GCM keys and bound to on-chain \`keccak256\` hashes.
5. **Fair Dispute Resolution:**
   - \`0\` upfront wallet balance required to open a dispute — escrowed order principal is never reduced.
   - **30-Minute Cooling-Off:** Before an arbiter calls \`takeCase\`, either party can settle directly within 30 minutes with \`0\` bond, \`0\` strike, and \`0\` concession.
   - **Asymmetric Loser-Pays Bond:** Only when an arbiter rules with \`applyBond == true\` does the losing party owe \`min(5 units, max(2 units, 5%))\` deducted from free merchant margin or recorded as FIFO debt.
   - **7-Day Backup Arbiter Fail-Safe:** Ensures no order can ever remain stuck in \`Disputed\`.

## 4. Swap & Cross-Chain Bridge

- **Swap (\`https://app.onpeer.xyz/swap\`):** Uses \`@circle-fin/app-kit\` (\`SwapKit\`) to quote and swap among \`USDC\`, \`EURC\`, \`cirBTC\`, and \`WETH\` on Arc Testnet with configurable slippage protection.
- **Bridge (\`https://app.onpeer.xyz/bridge\`):**
  - \`USDC\`: Circle CCTP v2 burn-and-mint with automatic Forwarding Service across Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Polygon Amoy, and Avalanche Fuji.
  - \`EURC\`, \`cirBTC\`, \`WETH\` (\`wETH\`): Circle CCTPx cross-chain token bridging with \`FAST\` and \`SLOW\` transfer speed selection and live step progress (\`approve -> transfer -> fetchAttestation -> forward\`).
`

export function handleSeoFileRequest(url: URL): Response | null {
  const p = url.pathname
  if (p === '/robots.txt') {
    return new Response(buildRobotsTxt(), {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  if (p === '/sitemap.xml') {
    return new Response(buildSitemapXml(), {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  if (p === '/llms.txt' || p === '/.well-known/llms.txt') {
    return new Response(LLMS_TXT, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  if (p === '/llms-full.txt') {
    return new Response(LLMS_FULL_TXT, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  return null
}
