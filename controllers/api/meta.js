const { sequelize } = require('../../db');

exports.getCsrfToken = (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
};

exports.getMe = (req, res) => {
    if (!req.session.isLoggedIn || !req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    const { _id, name, email, role, avatar, phone, address, sellerProfile, favourites, defaultPaymentMethod, savedCard, createdAt } = req.user;
    res.json({ user: { _id, name, email, role, avatar, phone, address, sellerProfile, favourites, defaultPaymentMethod: defaultPaymentMethod || 'card', savedCard: savedCard || null, createdAt } });
};

exports.getHealth = async (req, res) => {
    try {
        await sequelize.query('SELECT 1;');
        res.status(200).json({
            status: 'ok',
            database: 'connected',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            database: 'disconnected',
            message: err.message,
        });
    }
};
