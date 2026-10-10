const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const express = require('express');
const router = express.Router();

const { Product, Review, Order, OrderItem, User, Favourite, Address, SellerProfile } = require('../db/models');
const { sequelize } = require('../db');
const isAuth  = require('../middleware/is-auth');

// ─── Product search suggestions ────────────────────────────────────────────
// GET /api/products/suggestions?q=text
router.get('/products/suggestions', async (req, res, next) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ suggestions: [] });

        const query = `
            SELECT id, id AS _id, title, category, image_url AS "imageUrl", price
            FROM products
            WHERE search_vector @@ websearch_to_tsquery('english', :q)
               OR title ILIKE :likeQ
            ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', :q)) DESC, created_at DESC
            LIMIT 6
        `;
        const [docs] = await sequelize.query(query, {
            replacements: { q, likeQ: `%${q}%` },
        });

        res.json({ suggestions: docs });
    } catch (err) { next(err); }
});

// ─── Favourites ─────────────────────────────────────────────────────────────

// GET /api/favourites — list user's favourited products
router.get('/favourites', isAuth, async (req, res, next) => {
    try {
        const userId = req.user.id || req.user._id;
        const favRecords = await Favourite.findAll({
            where: { userId },
            include: [{ model: Product, as: 'product' }],
            order: [['productId', 'ASC']],
        });
        const favourites = favRecords
            .map(f => f.product)
            .filter(Boolean)
            .map(p => (p.toJSON ? p.toJSON() : p));
        res.json({ favourites });
    } catch (err) { next(err); }
});

// POST /api/favourites — toggle favourite { productId }
router.post('/favourites',
    isAuth,
    body('productId').isString().trim().notEmpty().withMessage('Invalid product'),
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(422).json({ errorMessage: errors.array()[0].msg });

            const productId = req.body.productId;
            const product = await Product.findByPk(productId);
            if (!product) return res.status(404).json({ message: 'Product not found' });

            const userId = req.user.id || req.user._id;
            const existing = await Favourite.findOne({ where: { userId, productId: product.id } });
            let favourited = false;
            if (existing) {
                await existing.destroy();
                favourited = false;
            } else {
                try {
                    await Favourite.create({ userId, productId: product.id });
                    favourited = true;
                } catch (err) {
                    if (err.name === 'SequelizeUniqueConstraintError') {
                        favourited = true;
                    } else {
                        throw err;
                    }
                }
            }
            const count = await Favourite.count({ where: { userId } });
            res.json({ favourited, count });
        } catch (err) { next(err); }
    }
);

// ─── Reviews ─────────────────────────────────────────────────────────────────

// GET /api/products/:productId/reviews?page=
router.get('/products/:productId/reviews', async (req, res, next) => {
    try {
        const productId = req.params.productId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(productId)) {
            return res.status(400).json({ message: 'Invalid product id' });
        }
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 10;
        const offset = (page - 1) * limit;

        const product = await Product.findByPk(productId);
        const reviews = await Review.findAll({
            where: { productId },
            order: [['createdAt', 'DESC']],
            offset,
            limit,
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] }],
        });
        const total = await Review.count({ where: { productId } });

        const [aggStats] = await sequelize.query(`
            SELECT rating, COUNT(*)::int AS count
            FROM reviews
            WHERE product_id = :productId
            GROUP BY rating
        `, {
            replacements: { productId },
        });

        // Build distribution
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        aggStats.forEach((item) => {
            const r = item.rating;
            const cnt = Number(item.count);
            if (distribution[r] !== undefined) {
                distribution[r] = cnt;
                sum += r * cnt;
            }
        });

        let average = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
        let totalCount = total;

        // Fallback for legacy seeded products where Review docs may be empty but product.ratings exist
        if (total === 0 && product?.ratingAverage && product.ratingCount > 0) {
            average = Number(product.ratingAverage);
            totalCount = Number(product.ratingCount);
            const highStars = Math.min(5, Math.max(1, Math.round(average)));
            const highCount = Math.round(totalCount * 0.7);
            const midCount = Math.round(totalCount * 0.2);
            const otherCount = Math.max(0, totalCount - highCount - midCount);
            distribution[highStars] = highCount;
            const nextStar = highStars > 1 ? highStars - 1 : 2;
            distribution[nextStar] = midCount;
            if (otherCount > 0) {
                const thirdStar = nextStar > 1 ? nextStar - 1 : 1;
                distribution[thirdStar] = otherCount;
            }
        }

        // Check if authenticated user has reviewed or purchased
        let userHasReviewed = false;
        let isVerifiedPurchaser = false;
        if (req.user) {
            const userId = req.user.id || req.user._id;
            const existingUserRev = await Review.findOne({ where: { productId, userId } });
            userHasReviewed = !!existingUserRev;

            const [orderRows] = await sequelize.query(`
                SELECT 1
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.user_id = :userId
                  AND oi.product_id = :productId
                  AND (o.payment_status = 'paid' OR o.status IN ('confirmed', 'shipped', 'delivered'))
                LIMIT 1
            `, {
                replacements: { userId, productId },
            });
            isVerifiedPurchaser = orderRows.length > 0;
        }

        res.json({
            reviews,
            pagination: {
                currentPage: page,
                lastPage: Math.max(1, Math.ceil(total / limit)),
                totalItems: total,
            },
            stats: {
                average,
                total: totalCount,
                distribution,
            },
            userHasReviewed,
            isVerifiedPurchaser,
        });
    } catch (err) { next(err); }
});

// POST /api/products/:productId/reviews
router.post('/products/:productId/reviews',
    isAuth,
    [
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5'),
        body('title').trim().isLength({ min: 2, max: 120 }).withMessage('Title is too short'),
        body('body').trim().isLength({ min: 10, max: 2000 }).withMessage('Review is too short'),
        body('name').optional().trim().isLength({ max: 100 }),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(422).json({ errorMessage: errors.array()[0].msg, validationErrors: errors.array() });
            }

            const productId = req.params.productId;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(productId)) {
                return res.status(400).json({ message: 'Invalid product id' });
            }

            const userId = req.user.id || req.user._id;

            const review = await sequelize.transaction(async (t) => {
                const product = await Product.findByPk(productId, { transaction: t });
                if (!product) {
                    const err = new Error('Product not found');
                    err.status = 404;
                    throw err;
                }

                // Check for duplicate
                const existing = await Review.findOne({
                    where: { productId, userId },
                    transaction: t,
                });
                if (existing) {
                    const err = new Error('You have already reviewed this product');
                    err.status = 409;
                    throw err;
                }

                // Check verified purchase
                const [orderRows] = await sequelize.query(`
                    SELECT 1
                    FROM orders o
                    JOIN order_items oi ON o.id = oi.order_id
                    WHERE o.user_id = :userId
                      AND oi.product_id = :productId
                      AND (o.payment_status = 'paid' OR o.status IN ('confirmed', 'shipped', 'delivered'))
                    LIMIT 1
                `, {
                    replacements: { userId, productId },
                    transaction: t,
                });
                const isVerified = orderRows.length > 0;

                const authorName = (req.body.name || req.user.name || '').trim();
                const authorAvatar = req.user.avatar || '';

                const createdReview = await Review.create({
                    productId,
                    userId,
                    userName: authorName,
                    userAvatar: authorAvatar,
                    rating: Number(req.body.rating),
                    title: req.body.title.trim(),
                    body: req.body.body.trim(),
                    verified: isVerified,
                }, { transaction: t });

                // Update user profile name if previously empty
                if ((!req.user.name || !req.user.name.trim()) && authorName) {
                    req.user.name = authorName;
                    await req.user.save({ transaction: t });
                }

                // Recalculate denormalised rating on product in same transaction
                const [stats] = await sequelize.query(`
                    SELECT COALESCE(AVG(rating), 0) AS avg, COUNT(*)::int AS cnt
                    FROM reviews
                    WHERE product_id = :productId
                `, {
                    replacements: { productId },
                    transaction: t,
                });
                const avg = Number(stats[0]?.avg || 0);
                const cnt = Number(stats[0]?.cnt || 0);
                product.ratingAverage = Math.round(avg * 10) / 10;
                product.ratingCount = cnt;
                await product.save({ transaction: t });

                return Review.findByPk(createdReview.id, {
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] }],
                    transaction: t,
                });
            });

            res.status(201).json({ review });
        } catch (err) {
            if (err.name === 'SequelizeUniqueConstraintError' || err.status === 409) {
                return res.status(409).json({ message: 'You have already reviewed this product' });
            }
            if (err.status) {
                return res.status(err.status).json({ message: err.message });
            }
            next(err);
        }
    }
);

// DELETE /api/reviews/:reviewId — own review or admin
router.delete('/reviews/:reviewId', isAuth, async (req, res, next) => {
    try {
        const reviewId = req.params.reviewId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(reviewId)) {
            return res.status(400).json({ message: 'Invalid review id' });
        }

        await sequelize.transaction(async (t) => {
            const review = await Review.findByPk(reviewId, { transaction: t });
            if (!review) {
                const err = new Error('Review not found');
                err.status = 404;
                throw err;
            }

            const currentUserId = req.user.id || req.user._id;
            const isOwner = review.userId.toString() === currentUserId.toString();
            const isAdmin = req.user.role === 'admin';
            if (!isOwner && !isAdmin) {
                const err = new Error('Not authorised');
                err.status = 403;
                throw err;
            }

            const targetProductId = review.productId;
            await review.destroy({ transaction: t });

            // Recalculate product ratings in same transaction
            const [stats] = await sequelize.query(`
                SELECT COALESCE(AVG(rating), 0) AS avg, COUNT(*)::int AS cnt
                FROM reviews
                WHERE product_id = :productId
            `, {
                replacements: { productId: targetProductId },
                transaction: t,
            });
            const avg = Number(stats[0]?.avg || 0);
            const cnt = Number(stats[0]?.cnt || 0);

            await Product.update({
                ratingAverage: Math.round(avg * 10) / 10,
                ratingCount: cnt,
            }, {
                where: { id: targetProductId },
                transaction: t,
            });
        });

        res.json({ message: 'Review deleted' });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }
        next(err);
    }
});

// ─── Account — profile & address ────────────────────────────────────────────

// GET /api/account/profile
router.get('/account/profile', isAuth, async (req, res, next) => {
    try {
        const userId = req.user.id || req.user._id;
        const user = await User.findByPk(userId, {
            include: [
                { model: Address, as: 'addresses' },
                { model: SellerProfile, as: 'sellerProfile' },
            ],
            order: [[{ model: Address, as: 'addresses' }, 'isDefault', 'DESC']],
        });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ user: user.toJSON() });
    } catch (err) { next(err); }
});

// PATCH /api/account/profile
router.patch('/account/profile',
    isAuth,
    [
        body('name').optional().trim().isLength({ max: 100 }),
        body('phone').optional().trim().isLength({ max: 30 }),
        body('avatar').optional().trim(),
        body('defaultPaymentMethod').optional().isIn(['card', 'apple_pay', 'cash_on_delivery']),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(422).json({ errorMessage: errors.array()[0].msg });

            const userId = req.user.id || req.user._id;
            const user = await User.findByPk(userId);
            if (!user) return res.status(404).json({ message: 'User not found' });

            const allowed = ['name', 'phone', 'avatar', 'defaultPaymentMethod'];
            allowed.forEach(f => { if (req.body[f] !== undefined) user[f] = req.body[f]; });

            if (req.body.savedCard !== undefined) {
                user.savedCard = req.body.savedCard;
            }

            if (req.file) {
                user.avatar = '/' + req.file.path.replace(/\\/g, '/').replace(/^\/+/, '');
            }

            if (req.body.address) {
                const addr = req.body.address;
                if (addr.street !== undefined) user.addressStreet = addr.street;
                if (addr.city !== undefined) user.addressCity = addr.city;
                if (addr.country !== undefined) user.addressCountry = addr.country;
                if (addr.postalCode !== undefined) user.addressPostal = addr.postalCode;
            }

            if (user.role === 'seller' && req.body.sellerProfile) {
                const sp = await SellerProfile.findOne({ where: { userId } });
                if (sp) {
                    await sp.update(req.body.sellerProfile);
                }
            }

            await user.save();

            const refreshed = await User.findByPk(userId, {
                include: [
                    { model: Address, as: 'addresses' },
                    { model: SellerProfile, as: 'sellerProfile' },
                ],
                order: [[{ model: Address, as: 'addresses' }, 'isDefault', 'DESC']],
            });
            res.json({ user: refreshed.toJSON() });
        } catch (err) { next(err); }
    }
);

// GET /api/account/addresses — list all saved addresses
router.get('/account/addresses', isAuth, async (req, res, next) => {
    try {
        const userId = req.user.id || req.user._id;
        const addresses = await Address.findAll({
            where: { userId },
            order: [['isDefault', 'DESC'], ['createdAt', 'ASC']],
        });
        res.json({ addresses });
    } catch (err) { next(err); }
});

// POST /api/account/addresses — add a new address
router.post('/account/addresses',
    isAuth,
    [
        body('street').trim().notEmpty().withMessage('Street is required'),
        body('city').trim().notEmpty().withMessage('City is required'),
        body('country').trim().notEmpty().withMessage('Country is required'),
        body('postalCode').optional().trim(),
        body('name').optional().trim(),
        body('phone').optional().trim(),
        body('label').optional().trim(),
        body('isDefault').optional().isBoolean(),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(422).json({ errorMessage: errors.array()[0].msg, validationErrors: errors.array() });

            const userId = req.user.id || req.user._id;

            const result = await sequelize.transaction(async (t) => {
                const existingCount = await Address.count({ where: { userId }, transaction: t });
                const isFirst = existingCount === 0;
                const makeDefault = req.body.isDefault === true || isFirst;

                if (makeDefault) {
                    await Address.update({ isDefault: false }, { where: { userId }, transaction: t });
                }

                const created = await Address.create({
                    userId,
                    label: (req.body.label || 'Home').trim(),
                    name: (req.body.name || req.user.name || '').trim(),
                    street: req.body.street.trim(),
                    city: req.body.city.trim(),
                    country: req.body.country.trim(),
                    postalCode: (req.body.postalCode || '').trim(),
                    phone: (req.body.phone || req.user.phone || '').trim(),
                    isDefault: makeDefault,
                }, { transaction: t });

                if (makeDefault) {
                    await User.update({
                        addressStreet: created.street,
                        addressCity: created.city,
                        addressCountry: created.country,
                        addressPostal: created.postalCode,
                    }, { where: { id: userId }, transaction: t });
                }

                const allAddresses = await Address.findAll({
                    where: { userId },
                    order: [['isDefault', 'DESC'], ['createdAt', 'ASC']],
                    transaction: t,
                });

                return { address: created, addresses: allAddresses };
            });

            res.status(201).json(result);
        } catch (err) { next(err); }
    }
);

// PATCH /api/account/addresses/:addressId — update address or set as default
router.patch('/account/addresses/:addressId',
    isAuth,
    [
        body('street').optional().trim().notEmpty().withMessage('Street cannot be empty'),
        body('city').optional().trim().notEmpty().withMessage('City cannot be empty'),
        body('country').optional().trim().notEmpty().withMessage('Country cannot be empty'),
        body('postalCode').optional().trim(),
        body('name').optional().trim(),
        body('phone').optional().trim(),
        body('label').optional().trim(),
        body('isDefault').optional().isBoolean(),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(422).json({ errorMessage: errors.array()[0].msg, validationErrors: errors.array() });

            const addressId = req.params.addressId;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(addressId)) {
                return res.status(400).json({ message: 'Invalid address ID' });
            }

            const userId = req.user.id || req.user._id;

            const result = await sequelize.transaction(async (t) => {
                const addr = await Address.findOne({
                    where: { id: addressId, userId },
                    transaction: t,
                });
                if (!addr) {
                    const err = new Error('Address not found');
                    err.status = 404;
                    throw err;
                }

                const fields = ['label', 'name', 'street', 'city', 'country', 'postalCode', 'phone'];
                fields.forEach(f => {
                    if (req.body[f] !== undefined) addr[f] = req.body[f].trim();
                });

                if (req.body.isDefault === true) {
                    await Address.update({ isDefault: false }, { where: { userId }, transaction: t });
                    addr.isDefault = true;
                    await User.update({
                        addressStreet: addr.street,
                        addressCity: addr.city,
                        addressCountry: addr.country,
                        addressPostal: addr.postalCode,
                    }, { where: { id: userId }, transaction: t });
                }

                await addr.save({ transaction: t });

                const allAddresses = await Address.findAll({
                    where: { userId },
                    order: [['isDefault', 'DESC'], ['createdAt', 'ASC']],
                    transaction: t,
                });

                return { address: addr, addresses: allAddresses };
            });

            res.json(result);
        } catch (err) {
            if (err.status) {
                return res.status(err.status).json({ message: err.message });
            }
            next(err);
        }
    }
);

// DELETE /api/account/addresses/:addressId — delete saved address
router.delete('/account/addresses/:addressId',
    isAuth,
    async (req, res, next) => {
        try {
            const addressId = req.params.addressId;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(addressId)) {
                return res.status(400).json({ message: 'Invalid address ID' });
            }

            const userId = req.user.id || req.user._id;

            const result = await sequelize.transaction(async (t) => {
                const addr = await Address.findOne({
                    where: { id: addressId, userId },
                    transaction: t,
                });
                if (!addr) {
                    const err = new Error('Address not found');
                    err.status = 404;
                    throw err;
                }

                const wasDefault = addr.isDefault;
                await addr.destroy({ transaction: t });

                const remaining = await Address.findAll({
                    where: { userId },
                    order: [['createdAt', 'ASC']],
                    transaction: t,
                });

                if (wasDefault && remaining.length > 0) {
                    remaining[0].isDefault = true;
                    await remaining[0].save({ transaction: t });
                    await User.update({
                        addressStreet: remaining[0].street,
                        addressCity: remaining[0].city,
                        addressCountry: remaining[0].country,
                        addressPostal: remaining[0].postalCode,
                    }, { where: { id: userId }, transaction: t });
                } else if (remaining.length === 0) {
                    await User.update({
                        addressStreet: '',
                        addressCity: '',
                        addressCountry: '',
                        addressPostal: '',
                    }, { where: { id: userId }, transaction: t });
                }

                const allAddresses = await Address.findAll({
                    where: { userId },
                    order: [['isDefault', 'DESC'], ['createdAt', 'ASC']],
                    transaction: t,
                });

                return { message: 'Address removed', addresses: allAddresses };
            });

            res.json(result);
        } catch (err) {
            if (err.status) {
                return res.status(err.status).json({ message: err.message });
            }
            next(err);
        }
    }
);

// ─── Sellers directory ────────────────────────────────────────────────────────

// GET /api/sellers — list all seller accounts (public, for map)
router.get('/sellers', async (req, res, next) => {
    try {
        const sellers = await User.findAll({
            where: { role: 'seller' },
            include: [{ model: sequelize.models.SellerProfile, as: 'sellerProfile' }],
        });
        res.json({ sellers });
    } catch (err) { next(err); }
});

// GET /api/sellers/:id — single seller public profile
router.get('/sellers/:id', async (req, res, next) => {
    try {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(req.params.id)) {
            return res.status(400).json({ message: 'Invalid seller id' });
        }
        const { Op } = require('sequelize');
        const seller = await User.findOne({
            where: { id: req.params.id, role: { [Op.in]: ['seller', 'admin'] } },
            include: [{ model: sequelize.models.SellerProfile, as: 'sellerProfile' }],
        });
        if (!seller) return res.status(404).json({ message: 'Seller not found' });

        // Return seller's products too
        const products = await Product.findAll({ where: { sellerId: req.params.id } });
        res.json({ seller, products });
    } catch (err) { next(err); }
});

// ─── File Uploads ─────────────────────────────────────────────────────────────

// POST /api/upload — upload an image file (auth required)
router.post('/upload', isAuth, (req, res) => {
    if (!req.file) {
        return res.status(422).json({ message: 'No valid image file uploaded. Supported formats: PNG, JPG, JPEG, WEBP.' });
    }
    const relativePath = '/' + req.file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    res.status(201).json({ imageUrl: relativePath });
});

module.exports = router;
