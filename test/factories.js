/**
 * @file test/factories.js
 * @description Centralized test data factories for PostgreSQL / Sequelize test suites.
 * Provides deterministic relational model creation and authenticated agent helpers.
 */

const bcrypt = require('bcryptjs');
const request = require('supertest');
const {
  User,
  SellerProfile,
  Address,
  Product,
  ProductVariant,
  CartItem,
  Favourite,
  Discount,
  Order,
  OrderItem,
  OrderTimeline,
  Review,
} = require('../db/models');

let counter = 0;
function uniqueSuffix() {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Creates a User record in the test database.
 * If role is 'seller', also automatically creates a corresponding SellerProfile.
 */
async function createUser(overrides = {}) {
  const plainPassword = overrides.password || 'Passw0rd!x';
  const passwordHash = overrides.passwordHash || (await bcrypt.hash(plainPassword, 4));
  const role = overrides.role || 'customer';
  const email = (overrides.email || `user-${uniqueSuffix()}@atelier.sa`).toLowerCase();
  const name = overrides.name || 'Artisan User';

  const user = await User.create({
    name,
    email,
    password: passwordHash,
    role,
    avatar: overrides.avatar || '',
    phone: overrides.phone || '+201000000000',
    addressStreet: overrides.addressStreet || '',
    addressCity: overrides.addressCity || '',
    addressCountry: overrides.addressCountry || '',
    addressPostal: overrides.addressPostal || '',
    defaultPayment: overrides.defaultPayment || 'card',
    savedCard: overrides.savedCard || null,
  });

  if (role === 'seller') {
    await SellerProfile.findOrCreate({
      where: { userId: user.id },
      defaults: {
        userId: user.id,
        shopName: overrides.shopName || `${name}'s Workshop`,
        shopDescription: overrides.shopDescription || 'Handcrafted artisanal goods.',
        shopBanner: overrides.shopBanner || '',
        city: overrides.city || 'Cairo',
        country: overrides.country || 'Egypt',
        lat: overrides.lat || 30.0444,
        lng: overrides.lng || 31.2357,
      },
    });
  }

  // Attach plain password so tests that log in can reference user.plainPassword
  user.plainPassword = plainPassword;
  return user;
}

/**
 * Creates a Product record owned by a seller.
 */
async function createProduct(sellerId, overrides = {}) {
  return await Product.create({
    sellerId,
    title: overrides.title || `Artisanal Craft ${uniqueSuffix()}`,
    description: overrides.description || 'Authentic handmade creation.',
    imageUrl: overrides.imageUrl || '/images/craft.jpg',
    price: overrides.price !== undefined ? overrides.price : 100,
    compareAtPrice: overrides.compareAtPrice !== undefined ? overrides.compareAtPrice : null,
    discountType: overrides.discountType || 'percentage',
    discountValue: overrides.discountValue !== undefined ? overrides.discountValue : 0,
    discountActive: overrides.discountActive !== undefined ? overrides.discountActive : false,
    category: overrides.category || 'ceramics',
    tags: overrides.tags || ['handmade', 'craft'],
    badge: overrides.badge || null,
    stock: overrides.stock !== undefined ? overrides.stock : 20,
    lowStockThreshold: overrides.lowStockThreshold || 5,
    isAvailable: overrides.isAvailable !== undefined ? overrides.isAvailable : true,
    ratingAverage: overrides.ratingAverage !== undefined ? overrides.ratingAverage : 0,
    ratingCount: overrides.ratingCount !== undefined ? overrides.ratingCount : 0,
    city: overrides.city || 'Cairo',
    country: overrides.country || 'Egypt',
    lat: overrides.lat || null,
    lng: overrides.lng || null,
  });
}

/**
 * Creates a ProductVariant record for a given product.
 */
async function createProductVariant(productId, overrides = {}) {
  return await ProductVariant.create({
    productId,
    name: overrides.name || 'Standard Edition',
    sku: overrides.sku || `SKU-${uniqueSuffix()}`,
    price: overrides.price !== undefined ? overrides.price : 100,
    compareAtPrice: overrides.compareAtPrice !== undefined ? overrides.compareAtPrice : null,
    stock: overrides.stock !== undefined ? overrides.stock : 10,
  });
}

/**
 * Creates an Address for a user.
 */
async function createAddress(userId, overrides = {}) {
  return await Address.create({
    userId,
    label: overrides.label || 'Home',
    name: overrides.name || 'Shopper Name',
    street: overrides.street || '123 Nile Corniche',
    city: overrides.city || 'Cairo',
    country: overrides.country || 'Egypt',
    postalCode: overrides.postalCode || '11511',
    phone: overrides.phone || '+201000000000',
    isDefault: overrides.isDefault !== undefined ? overrides.isDefault : false,
  });
}

/**
 * Creates a Discount voucher in the database.
 */
async function createDiscount(overrides = {}) {
  return await Discount.create({
    code: (overrides.code || `PROMO-${uniqueSuffix()}`).toUpperCase(),
    description: overrides.description || 'Promotional coupon',
    discountType: overrides.discountType || 'percentage',
    discountValue: overrides.discountValue !== undefined ? overrides.discountValue : 10,
    minOrderAmount: overrides.minOrderAmount !== undefined ? overrides.minOrderAmount : 0,
    maxDiscount: overrides.maxDiscount !== undefined ? overrides.maxDiscount : null,
    startDate: overrides.startDate || null,
    endDate: overrides.endDate || null,
    usageLimit: overrides.usageLimit !== undefined ? overrides.usageLimit : null,
    usedCount: overrides.usedCount !== undefined ? overrides.usedCount : 0,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    sellerId: overrides.sellerId || null,
  });
}

/**
 * Creates an Order with optional OrderItems and timeline entries.
 */
async function createOrder(userId, overrides = {}) {
  const order = await Order.create({
    userId,
    userEmail: overrides.userEmail || 'shopper@atelier.sa',
    userName: overrides.userName || 'Shopper Name',
    subtotal: overrides.subtotal !== undefined ? overrides.subtotal : 100,
    shippingFee: overrides.shippingFee !== undefined ? overrides.shippingFee : 0,
    discountCode: overrides.discountCode || '',
    discountType: overrides.discountType || '',
    discountValue: overrides.discountValue !== undefined ? overrides.discountValue : 0,
    discountAmount: overrides.discountAmount !== undefined ? overrides.discountAmount : 0,
    totalPrice: overrides.totalPrice !== undefined ? overrides.totalPrice : 100,
    status: overrides.status || 'pending',
    paymentStatus: overrides.paymentStatus || 'unpaid',
    paymentMethod: overrides.paymentMethod || 'card',
    paymentReference: overrides.paymentReference || '',
    shipName: overrides.shipName || 'Shopper Name',
    shipStreet: overrides.shipStreet || '123 Nile Corniche',
    shipCity: overrides.shipCity || 'Cairo',
    shipCountry: overrides.shipCountry || 'Egypt',
    shipPostalCode: overrides.shipPostalCode || '11511',
    carrier: overrides.carrier || 'Aramex White-Glove Express',
    trackingNumber: overrides.trackingNumber || '',
    notes: overrides.notes || '',
  });

  if (overrides.items && Array.isArray(overrides.items)) {
    for (const item of overrides.items) {
      await OrderItem.create({
        orderId: order.id,
        productId: item.productId || null,
        variantId: item.variantId || null,
        productSnapshot: item.productSnapshot || { title: 'Product', price: 100 },
        variantSnapshot: item.variantSnapshot || null,
        quantity: item.quantity || 1,
      });
    }
  }

  return order;
}

/**
 * Creates a Review record.
 */
async function createReview(productId, userId, overrides = {}) {
  return await Review.create({
    productId,
    userId,
    userName: overrides.userName || 'Reviewer',
    userAvatar: overrides.userAvatar || '',
    rating: overrides.rating !== undefined ? overrides.rating : 5,
    title: overrides.title || 'Wonderful craftsmanship',
    body: overrides.body || 'Exceeded my expectations in quality and detail.',
    verified: overrides.verified !== undefined ? overrides.verified : false,
  });
}

/**
 * Helper to log in a user and return supertest agent with csrf token.
 */
async function loginAgent(app, user, password = 'Passw0rd!x') {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/api/csrf-token');
  const csrf = csrfRes.body.csrfToken;
  await agent
    .post('/api/auth/login')
    .set('csrf-token', csrf)
    .send({ email: user.email, password: user.plainPassword || password });
  return { agent, csrf, user };
}

module.exports = {
  createUser,
  createProduct,
  createProductVariant,
  createAddress,
  createDiscount,
  createOrder,
  createReview,
  loginAgent,
};
