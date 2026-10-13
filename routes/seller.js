const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { sequelize } = require('../db');
const {
  Order,
  OrderItem,
  OrderTimeline,
  Product,
  SellerProfile,
  User,
} = require('../db/models');
const { isValidUuid, formatOrderResponse } = require('../services/orderService');
const isSellerOrAdmin = require('../middleware/require-role')('seller', 'admin');

// All seller routes require 'seller' or 'admin' role
router.use(isSellerOrAdmin);

// ─── GET /api/seller/stats ────────────────────────────────────────────────────
// Aggregated statistics for the authenticated seller using native PostgreSQL queries
router.get('/stats', async (req, res, next) => {
  try {
    const sellerId = req.user.id || req.user._id;

    // 1. Catalog metrics (product count, average rating, total reviews)
    const [catalogRows] = await sequelize.query(
      `SELECT 
         COUNT(*)::int AS total_products,
         COALESCE(ROUND(AVG(rating_average) FILTER (WHERE rating_count > 0), 1), 0)::float AS average_rating,
         COALESCE(SUM(rating_count), 0)::int AS total_reviews
       FROM products
       WHERE seller_id = :sellerId`,
      {
        replacements: { sellerId },
        type: sequelize.QueryTypes.SELECT,
      }
    );
    const catalog = catalogRows || {};

    // 2. Sales and Order metrics for seller's pieces
    const [salesRows] = await sequelize.query(
      `SELECT 
         COUNT(DISTINCT o.id)::int AS total_orders,
         COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'pending')::int AS pending_orders_count,
         COALESCE(ROUND(SUM(
           CASE 
             WHEN o.payment_status = 'paid' OR o.status IN ('confirmed', 'shipped', 'delivered')
             THEN (oi.product_snapshot->>'price')::numeric * oi.quantity
             ELSE 0
           END
         ), 2), 0)::numeric AS total_revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_snapshot->>'sellerId' = :sellerIdStr
          OR oi.product_snapshot->>'userId' = :sellerIdStr
          OR oi.product_id IN (SELECT id FROM products WHERE seller_id = :sellerId)`,
      {
        replacements: { sellerId, sellerIdStr: String(sellerId) },
        type: sequelize.QueryTypes.SELECT,
      }
    );
    const sales = salesRows || {};

    // 3. Recent 5 orders overview
    const recentOrdersRaw = await sequelize.query(
      `SELECT 
         o.id AS _id,
         o.created_at AS "createdAt",
         o.status,
         o.payment_status AS "paymentStatus",
         COALESCE(NULLIF(o.user_name, ''), o.user_email, 'Client') AS "customerName",
         o.user_email AS "customerEmail",
         SUM(oi.quantity)::int AS "itemsCount",
         ROUND(SUM((oi.product_snapshot->>'price')::numeric * oi.quantity), 2)::numeric AS "sellerTotal"
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.product_snapshot->>'sellerId' = :sellerIdStr
          OR oi.product_snapshot->>'userId' = :sellerIdStr
          OR oi.product_id IN (SELECT id FROM products WHERE seller_id = :sellerId)
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 5`,
      {
        replacements: { sellerId, sellerIdStr: String(sellerId) },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    res.json({
      stats: {
        totalRevenue: Number(sales.total_revenue || 0),
        totalOrders: Number(sales.total_orders || 0),
        pendingOrdersCount: Number(sales.pending_orders_count || 0),
        totalProducts: Number(catalog.total_products || 0),
        averageRating: Number(catalog.average_rating || 0),
        totalReviews: Number(catalog.total_reviews || 0),
      },
      recentOrders: recentOrdersRaw.map((o) => ({
        ...o,
        sellerTotal: Number(o.sellerTotal || 0),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/seller/orders ───────────────────────────────────────────────────
// List orders containing seller's items with optional ?status= filter
router.get('/orders', async (req, res, next) => {
  try {
    const sellerId = req.user.id || req.user._id;
    const sellerIdStr = String(sellerId);
    const { status } = req.query;

    const orders = await Order.findAll({
      where: status && ['pending', 'confirmed', 'crafting', 'shipped', 'delivered', 'cancelled'].includes(status)
        ? { status }
        : {},
      include: [
        { model: OrderItem, as: 'items' },
        { model: OrderTimeline, as: 'timeline' },
      ],
      order: [['createdAt', 'DESC']],
    });

    const filteredOrders = [];

    for (const order of orders) {
      const items = order.items || [];
      const sellerItems = items.filter((item) => {
        const snap = item.productSnapshot || {};
        const snapSeller = String(snap.sellerId || snap.userId || '');
        return snapSeller === sellerIdStr;
      });

      if (sellerItems.length === 0) continue;

      const sellerProducts = sellerItems.map((item) => ({
        _id: item.id || item._id,
        quantity: item.quantity,
        productData: item.productSnapshot,
        variant: item.variantSnapshot,
      }));

      const sellerSubtotal = sellerItems.reduce((sum, item) => {
        const price = Number(item.productSnapshot?.price) || 0;
        const qty = Number(item.quantity) || 1;
        return sum + price * qty;
      }, 0);

      const formatted = formatOrderResponse(order);

      filteredOrders.push({
        _id: formatted._id,
        createdAt: formatted.createdAt,
        status: formatted.status,
        paymentStatus: formatted.paymentStatus,
        paymentMethod: formatted.paymentMethod,
        carrier: formatted.carrier || 'Aramex White-Glove Express',
        trackingNumber: formatted.trackingNumber || '',
        estimatedDeliveryDate: formatted.estimatedDeliveryDate,
        timeline: formatted.timeline || [],
        shippingAddress: formatted.shippingAddress || {},
        customer: {
          name: formatted.user?.name || '',
          email: formatted.user?.email || '',
        },
        products: sellerProducts,
        sellerSubtotal: Math.round(sellerSubtotal * 100) / 100,
        orderTotal: Number(formatted.totalPrice),
      });
    }

    res.json({ orders: filteredOrders });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/seller/orders/:orderId/status ─────────────────────────────────
// Update order fulfillment status, carrier, tracking number, and append timeline milestone
router.patch(
  '/orders/:orderId/status',
  [
    body('status')
      .isIn(['pending', 'confirmed', 'crafting', 'shipped', 'delivered', 'cancelled'])
      .withMessage('Invalid order status'),
    body('trackingNumber').optional().trim().isLength({ max: 100 }),
    body('carrier').optional().trim().isLength({ max: 100 }),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(422)
          .json({ errorMessage: errors.array()[0].msg, validationErrors: errors.array() });
      }

      const { orderId } = req.params;
      if (!isValidUuid(orderId)) {
        return res.status(400).json({ message: 'Invalid order ID' });
      }

      const order = await Order.findByPk(orderId, {
        include: [
          { model: OrderItem, as: 'items' },
          { model: OrderTimeline, as: 'timeline' },
        ],
      });

      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Authorize: seller must own at least one item in the order, or user is admin
      const sellerIdStr = String(req.user.id || req.user._id);
      const items = order.items || [];
      const ownsItem = items.some((item) => {
        const snap = item.productSnapshot || {};
        const snapSeller = String(snap.sellerId || snap.userId || '');
        return snapSeller === sellerIdStr;
      });

      if (!ownsItem && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Not authorized to modify this order' });
      }

      order.status = req.body.status;
      if (req.body.trackingNumber !== undefined) {
        order.trackingNumber = req.body.trackingNumber.trim();
      }
      if (req.body.carrier !== undefined && req.body.carrier.trim()) {
        order.carrier = req.body.carrier.trim();
      }
      if (req.body.estimatedDeliveryDate !== undefined) {
        order.estimatedDeliveryDate = req.body.estimatedDeliveryDate;
      }

      const defaultNotes = {
        pending: 'Order received and awaiting processing.',
        confirmed: 'Order confirmed and payment secured.',
        crafting: 'Artisan has commenced handcrafting in the studio workshop.',
        shipped: `Parcel dispatched via ${order.carrier || 'courier'}${
          order.trackingNumber ? ` (${order.trackingNumber})` : ''
        }.`,
        delivered: 'Package successfully delivered to patron.',
        cancelled: 'Order has been cancelled.',
      };

      const note = req.body.note?.trim() || defaultNotes[order.status] || `Status updated to ${order.status}`;

      await order.save();

      await OrderTimeline.create({
        orderId: order.id,
        status: order.status,
        note,
      });

      const updated = await Order.findByPk(order.id, {
        include: [
          { model: OrderItem, as: 'items' },
          { model: OrderTimeline, as: 'timeline' },
        ],
      });

      res.json({ message: 'Order status updated successfully', order: formatOrderResponse(updated) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/seller/profile ──────────────────────────────────────────────────
// Retrieve seller profile
router.get('/profile', async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findByPk(userId, {
      include: [{ model: SellerProfile, as: 'sellerProfile' }],
    });

    const sp = user.sellerProfile || {};
    res.json({
      seller: {
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        sellerProfile: {
          shopName: sp.shopName || '',
          shopDescription: sp.shopDescription || '',
          shopBanner: sp.shopBanner || '',
          location: {
            city: sp.city || '',
            country: sp.country || '',
            lat: sp.lat || null,
            lng: sp.lng || null,
          },
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/seller/profile ────────────────────────────────────────────────
// Update seller profile details
router.patch(
  '/profile',
  [
    body('shopName').optional().trim().isLength({ max: 100 }).withMessage('Shop name too long'),
    body('shopDescription').optional().trim().isLength({ max: 1000 }).withMessage('Shop description too long'),
    body('shopBanner').optional().trim(),
    body('city').optional().trim().isLength({ max: 100 }),
    body('country').optional().trim().isLength({ max: 100 }),
    body('name').optional().trim().isLength({ max: 100 }),
    body('avatar').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errorMessage: errors.array()[0].msg });
      }

      const userId = req.user.id || req.user._id;
      const user = await User.findByPk(userId, {
        include: [{ model: SellerProfile, as: 'sellerProfile' }],
      });

      if (req.body.name !== undefined) user.name = req.body.name.trim();
      if (req.body.avatar !== undefined) user.avatar = req.body.avatar.trim();
      await user.save();

      let profile = user.sellerProfile;
      const profileUpdates = {};
      if (req.body.shopName !== undefined) profileUpdates.shopName = req.body.shopName;
      if (req.body.shopDescription !== undefined) profileUpdates.shopDescription = req.body.shopDescription;
      if (req.body.shopBanner !== undefined) profileUpdates.shopBanner = req.body.shopBanner;
      if (req.body.city !== undefined) profileUpdates.city = req.body.city;
      if (req.body.country !== undefined) profileUpdates.country = req.body.country;

      if (profile) {
        await profile.update(profileUpdates);
      } else {
        profile = await SellerProfile.create({
          userId: user.id,
          ...profileUpdates,
        });
      }

      res.json({
        message: 'Seller profile updated successfully',
        seller: {
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          sellerProfile: {
            shopName: profile.shopName || '',
            shopDescription: profile.shopDescription || '',
            shopBanner: profile.shopBanner || '',
            location: {
              city: profile.city || '',
              country: profile.country || '',
              lat: profile.lat || null,
              lng: profile.lng || null,
            },
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
