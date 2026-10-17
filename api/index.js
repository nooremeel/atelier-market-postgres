const app = require('../app');
const { sequelize } = require('../db');

module.exports = async (req, res) => {
  // Handle Vercel internal rewrite path mapping
  if (req.headers['x-matched-path']) {
    req.url = req.headers['x-matched-path'];
  } else if (req.url.startsWith('/api/index.js')) {
    req.url = req.url.replace(/^\/api\/index\.js/, '/api') || '/api';
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
