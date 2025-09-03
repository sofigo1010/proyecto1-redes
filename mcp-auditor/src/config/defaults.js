export const DEFAULTS = Object.freeze({
  // Networking
  TIMEOUT_MS: 12_000,
  USER_AGENT: 'BevstackAuditor/1.0 (+https://bevstack.io)',
  MAX_HTML_SIZE_BYTES: 2_000_000,

  // Tipos de página
  TYPES: /** @type {const} */ (['privacy', 'terms', 'faq']),

  // Heurísticas de descubrimiento (tails)
  CANDIDATE_TAILS: {
    privacy: ['privacy', 'privacy-policy', 'policy', 'policies'],
    terms:   ['terms', 'terms-of-service', 'terms-and-conditions', 'legal'],
    faq:     ['faq', 'faqs', 'help', 'support'],
  },

  // Umbrales (0–100)
  PASS_THRESHOLD: 80,  // PP y TOS
  FAQ_SOFT_PASS:  60,  // FAQ más laxo

  // Secciones requeridas por tipo (texto en minúsculas del lado del parser)
  REQUIRED_SECTIONS: {
    privacy: [
      'personal information',
      'cookies',
      'tracking',
      'data security',
      'your rights',
      'contact',
    ],
    terms: [
      'limitation of liability',
      'governing law',
      'jurisdiction',
      'returns',
      'refunds',
      'shipping',
    ],
    faq: [
      'shipping',
      'delivery',
      'tracking',
      'returns',
      'refund',
      'exchange',
    ],
  },

  // Spellcheck
  ENABLE_SPELLCHECK: true,
  SPELL_WHITELIST: [
    'bevstack',
    'mezcal',
    'anejo','añejo',
    'reposado',
    'blanco',
    'joven',
    'añada',
    'tequila',
    'raicilla',
    'bacanora',
    'sotol',
    'sku','skus',
    'ecommerce',
    'shopify',
    'fulfillment',
    'drizly',
    'instacart',
  ],
});

export default DEFAULTS;