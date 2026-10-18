const app = require('../app');
const { sequelize } = require('../db');

module.exports = async (req, res) => {
  // Normalize incoming URL for Express router
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && !matchedPath.endsWith('/index.js') && !matchedPath.endsWith('/index') && matchedPath !== '/api') {
    req.url = matchedPath;
  } else if (req.url.startsWith('/api/index.js')) {
    const forwardedUrl = req.headers['x-forwarded-url'] || req.headers['x-vercel-matched-path'];
    if (forwardedUrl && (forwardedUrl.startsWith('/api') || forwardedUrl.startsWith('/images'))) {
      req.url = forwardedUrl;
    } else {
      req.url = req.url.replace(/^\/api\/index\.js/, '/api') || '/api';
    }
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/images')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('[Vercel Serverless Function DB Error]:', err);
    return res.status(500).json({
      message: 'Failed to connect to database',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  }

  return app(req, res);
};
