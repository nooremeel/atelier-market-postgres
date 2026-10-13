/**
 * @file services/adminService.js
 * @description Domain logic for platform administration: platform-wide Gross Merchandise Value (GMV),
 *              marketplace analytics, cross-seller order audit, and artisan directory metrics.
 *              Executes high-performance native PostgreSQL queries with GROUP BY, SUM, and COUNT.
 */

const { sequelize } = require('../db');
const { formatOrderResponse } = require('./orderService');
const { Order, OrderItem, OrderTimeline } = require('../db/models');

/**
 * Aggregates marketplace-wide metrics, recent orders, and ranked artisan sales
 * using native PostgreSQL aggregations.
 *
 * @returns {Promise<{ stats: object, recentOrders: Array, topArtisans: Array }>}
 */
async function getPlatformStats() {
  // 1. Order and Revenue Aggregates
  const orderStatsRows = await sequelize.query(
    `SELECT 
       COUNT(*)::int AS total_orders,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders_count,
       COALESCE(SUM(total_price) FILTER (
         WHERE payment_status = 'paid' OR status IN ('confirmed', 'shipped', 'delivered')
       ), 0)::numeric AS total_revenue
     FROM orders`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const orderStats = orderStatsRows[0] || {};

  // 2. Platform Entity Counts
  const countRows = await sequelize.query(
    `SELECT 
       (SELECT COUNT(*)::int FROM products) AS total_products,
       (SELECT COUNT(*)::int FROM users WHERE role = 'seller') AS total_artisans,
       (SELECT COUNT(*)::int FROM users WHERE role = 'customer') AS total_customers`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const counts = countRows[0] || {};

  // 3. Recent 6 Orders
  const recentOrdersRaw = await sequelize.query(
    `SELECT 
       o.id AS _id,
       o.created_at AS "createdAt",
       o.status,
       o.payment_status AS "paymentStatus",
       COALESCE(NULLIF(o.user_name, ''), o.user_email, 'Patron') AS "customerName",
       o.user_email AS "customerEmail",
       o.total_price AS "totalPrice",
       COALESCE(SUM(oi.quantity), 0)::int AS "itemsCount"
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT 6`,
    { type: sequelize.QueryTypes.SELECT }
  );

  // 4. Top Artisans ranked by gross sales
  const topArtisans = await sequelize.query(
    `SELECT 
       u.id AS _id,
       u.name,
       u.email,
       u.avatar,
       COALESCE(NULLIF(sp.shop_name, ''), u.name) AS "shopName",
       json_build_object('city', COALESCE(sp.city, ''), 'country', COALESCE(sp.country, '')) AS location,
       u.created_at AS "joinedAt",
       (SELECT COUNT(*)::int FROM products p2 WHERE p2.seller_id = u.id) AS "productCount",
       COALESCE(ROUND(SUM(
         CASE 
           WHEN o.payment_status = 'paid' OR o.status IN ('confirmed', 'shipped', 'delivered')
           THEN (oi.product_snapshot->>'price')::numeric * oi.quantity
           ELSE 0
         END
       ), 2), 0)::numeric AS "grossSales"
     FROM users u
     LEFT JOIN seller_profiles sp ON sp.user_id = u.id
     LEFT JOIN products p ON p.seller_id = u.id
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id
     WHERE u.role = 'seller'
     GROUP BY u.id, sp.shop_name, sp.city, sp.country
     ORDER BY "grossSales" DESC`,
    { type: sequelize.QueryTypes.SELECT }
  );

  return {
    stats: {
      totalRevenue: Number(orderStats.total_revenue || 0),
      totalOrders: Number(orderStats.total_orders || 0),
      pendingOrdersCount: Number(orderStats.pending_orders_count || 0),
      totalProducts: Number(counts.total_products || 0),
      totalArtisans: Number(counts.total_artisans || 0),
      totalCustomers: Number(counts.total_customers || 0),
    },
    recentOrders: recentOrdersRaw.map((o) => ({
      ...o,
      totalPrice: Number(o.totalPrice),
    })),
    topArtisans: topArtisans.map((a) => ({
      ...a,
      grossSales: Number(a.grossSales || 0),
      productCount: Number(a.productCount || 0),
    })),
  };
}

/**
 * Returns all platform orders sorted descending by creation time.
 *
 * @returns {Promise<Array>}
 */
async function getAllOrders() {
  const orders = await Order.findAll({
    include: [
      { model: OrderItem, as: 'items' },
      { model: OrderTimeline, as: 'timeline' },
    ],
    order: [['createdAt', 'DESC']],
  });
  return orders.map(formatOrderResponse);
}

/**
 * Returns the artisan directory with associated active piece counts.
 *
 * @returns {Promise<Array>}
 */
async function getArtisansDirectory() {
  return sequelize.query(
    `SELECT 
       u.id AS _id,
       u.name,
       u.email,
       u.avatar,
       json_build_object(
         'shopName', COALESCE(sp.shop_name, ''),
         'shopDescription', COALESCE(sp.shop_description, ''),
         'shopBanner', COALESCE(sp.shop_banner, ''),
         'location', json_build_object('city', COALESCE(sp.city, ''), 'country', COALESCE(sp.country, ''))
       ) AS "sellerProfile",
       u.created_at AS "createdAt",
       (SELECT COUNT(*)::int FROM products p WHERE p.seller_id = u.id) AS "productCount"
     FROM users u
     LEFT JOIN seller_profiles sp ON sp.user_id = u.id
     WHERE u.role = 'seller'
     ORDER BY u.created_at DESC`,
    { type: sequelize.QueryTypes.SELECT }
  );
}

module.exports = {
  getPlatformStats,
  getAllOrders,
  getArtisansDirectory,
};
