const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const express = require('express');
const router = express.Router();

const { Product, Review, Order, OrderItem, User } = require('../db/models');
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
        const user = req.user.populate ? await req.user.populate('favourites') : req.user;
        const seen = new Set();
        const uniqueFavourites = (user.favourites || []).filter(item => {
            if (!item || (!item._id && !item.id)) return false;
            const id = (item._id || item.id).toString();
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        res.json({ favourites: uniqueFavourites });
    } catch (err) { next(err); }
});

// POST /api/favourites — toggle favourite { productId }
router.post('/favourites',
    isAuth,
    body('productId').isString().withMessage('Invalid product'),
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(422).json({ errorMessage: errors.array()[0].msg });

            const product = await Product.findById(req.body.productId);
            if (!product) return res.status(404).json({ message: 'Product not found' });

            if (req.user.toggleFavourite) {
                await req.user.toggleFavourite(req.body.productId);
            }
            const isFav = req.user.isFavourite ? req.user.isFavourite(req.body.productId) : false;
            res.json({ favourited: isFav, count: (req.user.favourites || []).length });
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
router.get('/account/profile', isAuth, (req, res) => {
    const { _id, name, email, role, avatar, phone, address, addresses, sellerProfile, favourites, defaultPaymentMethod, savedCard, createdAt } = req.user;
    res.json({ user: { _id, name, email, role, avatar, phone, address, addresses: addresses || [], sellerProfile, favourites, defaultPaymentMethod: defaultPaymentMethod || 'card', savedCard: savedCard || null, createdAt } });
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

            const allowed = ['name', 'phone', 'avatar', 'defaultPaymentMethod'];
            allowed.forEach(f => { if (req.body[f] !== undefined) req.user[f] = req.body[f]; });

            if (req.body.savedCard !== undefined) {
                req.user.savedCard = req.body.savedCard;
            }

            if (req.file) {
                req.user.avatar = '/' + req.file.path.replace(/\\/g, '/').replace(/^\/+/, '');
            }

            if (req.body.address) {
                req.user.address = { ...req.user.address.toObject?.() ?? req.user.address, ...req.body.address };
            }

            // Seller profile fields
            if (req.user.role === 'seller' && req.body.sellerProfile) {
                req.user.sellerProfile = { ...(req.user.sellerProfile ?? {}), ...req.body.sellerProfile };
            }

            await req.user.save();
            const { _id, name, email, role, avatar, phone, address, addresses, sellerProfile, favourites, defaultPaymentMethod, savedCard, createdAt } = req.user;
            res.json({ user: { _id, name, email, role, avatar, phone, address, addresses: addresses || [], sellerProfile, favourites, defaultPaymentMethod: defaultPaymentMethod || 'card', savedCard: savedCard || null, createdAt } });
        } catch (err) { next(err); }
    }
);

// GET /api/account/addresses — list all saved addresses
router.get('/account/addresses', isAuth, (req, res) => {
    res.json({ addresses: req.user.addresses || [] });
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

            if (!req.user.addresses) req.user.addresses = [];

            const isFirst = req.user.addresses.length === 0;
            const makeDefault = req.body.isDefault === true || isFirst;

            if (makeDefault) {
                req.user.addresses.forEach(a => { a.isDefault = false; });
            }

            const newAddress = {
                label: (req.body.label || 'Home').trim(),
                name: (req.body.name || req.user.name || '').trim(),
                street: req.body.street.trim(),
                city: req.body.city.trim(),
                country: req.body.country.trim(),
                postalCode: (req.body.postalCode || '').trim(),
                phone: (req.body.phone || req.user.phone || '').trim(),
                isDefault: makeDefault,
            };

            req.user.addresses.push(newAddress);

            // Sync user.address if this is default
            if (makeDefault) {
                req.user.address = {
                    street: newAddress.street,
                    city: newAddress.city,
                    country: newAddress.country,
                    postalCode: newAddress.postalCode,
                };
            }

            await req.user.save();
            const created = req.user.addresses[req.user.addresses.length - 1];
            res.status(201).json({ address: created, addresses: req.user.addresses });
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

            if (!mongoose.Types.ObjectId.isValid(req.params.addressId)) {
                return res.status(400).json({ message: 'Invalid address ID' });
            }

            const addr = req.user.addresses?.id(req.params.addressId);
            if (!addr) return res.status(404).json({ message: 'Address not found' });

            const fields = ['label', 'name', 'street', 'city', 'country', 'postalCode', 'phone'];
            fields.forEach(f => {
                if (req.body[f] !== undefined) addr[f] = req.body[f].trim();
            });

            if (req.body.isDefault === true) {
                req.user.addresses.forEach(a => {
                    a.isDefault = a._id.toString() === addr._id.toString();
                });
                req.user.address = {
                    street: addr.street,
                    city: addr.city,
                    country: addr.country,
                    postalCode: addr.postalCode,
                };
            }

            await req.user.save();
            res.json({ address: addr, addresses: req.user.addresses });
        } catch (err) { next(err); }
    }
);

// DELETE /api/account/addresses/:addressId — delete saved address
router.delete('/account/addresses/:addressId',
    isAuth,
    async (req, res, next) => {
        try {
            if (!mongoose.Types.ObjectId.isValid(req.params.addressId)) {
                return res.status(400).json({ message: 'Invalid address ID' });
            }

            const addr = req.user.addresses?.id(req.params.addressId);
            if (!addr) return res.status(404).json({ message: 'Address not found' });

            const wasDefault = addr.isDefault;
            req.user.addresses.pull(req.params.addressId);

            if (wasDefault && req.user.addresses.length > 0) {
                req.user.addresses[0].isDefault = true;
                req.user.address = {
                    street: req.user.addresses[0].street,
                    city: req.user.addresses[0].city,
                    country: req.user.addresses[0].country,
                    postalCode: req.user.addresses[0].postalCode,
                };
            } else if (req.user.addresses.length === 0) {
                req.user.address = { street: '', city: '', country: '', postalCode: '' };
            }

            await req.user.save();
            res.json({ message: 'Address removed', addresses: req.user.addresses });
        } catch (err) { next(err); }
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
