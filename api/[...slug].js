/**
 * @file api/[...slug].js
 * @description Vercel serverless catch-all function handler for all /api/* sub-routes.
 * Delegates directly to the canonical api/index.js handler while natively preserving
 * path parameters and URL hierarchy across the Vercel Edge routing layer.
 */

module.exports = require('./index');
