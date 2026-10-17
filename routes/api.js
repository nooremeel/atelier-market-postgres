const express = require('express');
const meta = require('../controllers/api/meta');
const shopRoutes    = require('./shop');
const authRoutes    = require('./auth');
const adminRoutes   = require('./admin');
const extendedRoutes = require('./extended');
const sellerRoutes   = require('./seller');
const discountRoutes = require('./discount');
const paymobRoutes   = require('./paymob');

const router = express.Router();

router.get('/csrf-token', meta.getCsrfToken);
router.get('/auth/me', meta.getMe);
router.use('/auth', authRoutes);
router.use('/seller', sellerRoutes);
router.use('/paymob', paymobRoutes);
router.use('/', shopRoutes);
router.use('/', adminRoutes.routes);
router.use('/', discountRoutes);
// Extended marketplace routes (search suggestions, favourites, reviews, account, sellers)
router.use('/', extendedRoutes);
router.get('/health', meta.getHealth);

module.exports = router;
