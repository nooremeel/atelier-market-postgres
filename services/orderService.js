/**
 * @file services/orderService.js
 * @description Domain logic for orders: transactional order creation from PostgreSQL cart,
 *              row-level locking and atomic inventory decrementing, discount voucher application,
 *              idempotent Paymob reconciliation and fulfillment, and order history retrieval.
 */

const { Op } = require('sequelize');
const { sequelize } = require('../db');
const {
  Order,
  OrderItem,
  OrderTimeline,
  Product,
  ProductVariant,
  CartItem,
  Discount,
  User,
  Address,
} = require('../db/models');
const paymobService = require('./paymobService');

/**
 * Validates whether a given string is a valid v4 UUID.
 * @param {string} str
 * @returns {boolean}
 */
function isValidUuid(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Normalizes an Order instance into the standard API response structure matching the MongoDB contract.
 *
 * @param {Order} order
 * @returns {object} Formatted order object
 */
function formatOrderResponse(order) {
  if (!order) return null;
  const json = order.toJSON ? order.toJSON() : order;
  const items = order.items || [];
  const timeline = order.timeline || [];

  const products = items.map((i) => ({
    _id: i.id || i._id,
    id: i.id || i._id,
    quantity: Number(i.quantity),
    productData: i.productSnapshot || i.productData,
    variant: i.variantSnapshot || i.variant,
    productId: i.productId,
    variantId: i.variantId,
  }));

  const formattedTimeline = timeline.map((tl) => ({
    _id: tl.id || tl._id,
    id: tl.id || tl._id,
    status: tl.status,
    timestamp: tl.createdAt || tl.timestamp,
    note: tl.note || '',
  }));

  return {
    ...json,
    _id: json.id || json._id,
    id: json.id || json._id,
    subtotal: Number(json.subtotal || 0),
    shippingFee: Number(json.shippingFee || 0),
    totalPrice: Number(json.totalPrice || 0),
    products: json.products && json.products.length > 0 ? json.products : products,
    timeline: json.timeline && json.timeline.length > 0 ? json.timeline : formattedTimeline,
    user: {
      userId: json.userId,
      email: json.userEmail,
      name: json.userName || '',
    },
    shippingAddress: {
      name: json.shipName || '',
      street: json.shipStreet || '',
      city: json.shipCity || '',
      country: json.shipCountry || '',
      postalCode: json.shipPostalCode || '',
    },
    discount: {
      code: json.discountCode || '',
      discountType: json.discountType || '',
      discountValue: json.discountValue !== undefined ? Number(json.discountValue) : 0,
      amount: json.discountAmount !== undefined ? Number(json.discountAmount) : 0,
    },
  };
}

/**
 * Fulfills an order transactionally and idempotently.
 * Solves Problem P5: guarantees that replaying a webhook or inquiry will never
 * double-decrement stock or re-credit orders.
 *
 * @param {object} params
 * @param {string} params.orderId - UUID of the order
 * @param {string|number} params.transactionId - Paymob financial transaction identifier
 * @param {string} [params.note] - Optional custom timeline note
 * @returns {Promise<{ alreadyProcessed: boolean, notFound?: boolean, refundRequired?: boolean, order?: object }>}
 */
async function fulfillOrderTransactionally({ orderId, transactionId, note }) {
  if (!isValidUuid(orderId)) {
    return { alreadyProcessed: false, notFound: true };
  }

  const t = await sequelize.transaction();
  try {
    // 1. Atomic conditional update on order status:
    // Only updates if payment_status is currently 'unpaid'.
    // If rowCount is 0, the order was already fulfilled or does not exist.
    const [result] = await sequelize.query(
      `UPDATE orders 
       SET payment_status = 'paid', status = 'confirmed', 
           payment_reference = :paymentRef, updated_at = now()
       WHERE id = :orderId AND payment_status = 'unpaid'
       RETURNING *`,
      {
        replacements: {
          orderId,
          paymentRef: `PAYMOB-TXN-${transactionId || Date.now()}`,
        },
        transaction: t,
      }
    );

    const updatedRows = Array.isArray(result) ? result : [];
    if (updatedRows.length === 0) {
      await t.commit();
      const existing = await Order.findByPk(orderId, {
        include: [
          { model: OrderItem, as: 'items' },
          { model: OrderTimeline, as: 'timeline' },
        ],
      });
      if (!existing) return { alreadyProcessed: false, notFound: true };
      return { alreadyProcessed: true, notFound: false, order: formatOrderResponse(existing) };
    }

    const orderRow = updatedRows[0];

    // 2. Fetch items for this order to decrement inventory in the exact same transaction
    const items = await OrderItem.findAll({
      where: { orderId },
      transaction: t,
    });

    let stockDecrementFailed = false;

    // Lock and decrement items in deterministic order to prevent deadlocks
    const sortedItems = [...items].sort((a, b) => {
      const pComp = String(a.productId || '').localeCompare(String(b.productId || ''));
      if (pComp !== 0) return pComp;
      return String(a.variantId || '').localeCompare(String(b.variantId || ''));
    });

    for (const item of sortedItems) {
      const qty = Number(item.quantity);

      if (item.variantId) {
        const [vRows] = await sequelize.query(
          `UPDATE product_variants 
           SET stock = stock - :qty 
           WHERE id = :variantId AND stock >= :qty 
           RETURNING id`,
          {
            replacements: { qty, variantId: item.variantId },
            transaction: t,
          }
        );
        if (!vRows || vRows.length === 0) stockDecrementFailed = true;
      }

      if (item.productId) {
        const [pRows] = await sequelize.query(
          `UPDATE products 
           SET stock = stock - :qty 
           WHERE id = :productId AND stock >= :qty 
           RETURNING id`,
          {
            replacements: { qty, productId: item.productId },
            transaction: t,
          }
        );
        if (!pRows || pRows.length === 0) stockDecrementFailed = true;
      }
    }

    if (stockDecrementFailed) {
      // Architectural Decision D9:
      // If stock check fails after payment authorization, cancel the order and mark refund required.
      console.warn(`[Paymob Stock Guard Failed]: Order ${orderId} settled but stock insufficient. Marking cancelled.`);
      await sequelize.query(
        `UPDATE orders SET status = 'cancelled' WHERE id = :orderId`,
        { replacements: { orderId }, transaction: t }
      );
      await OrderTimeline.create(
        {
          orderId,
          status: 'cancelled',
          note: 'Stock unavailable at payment settlement. Order cancelled - refund required.',
        },
        { transaction: t }
      );
      await t.commit();
      const updatedOrder = await Order.findByPk(orderId, {
        include: [
          { model: OrderItem, as: 'items' },
          { model: OrderTimeline, as: 'timeline' },
        ],
      });
      return { alreadyProcessed: false, refundRequired: true, order: formatOrderResponse(updatedOrder) };
    }

    // 3. Increment discount usage count if applied
    if (orderRow.discount_code) {
      await sequelize.query(
        `UPDATE discounts SET used_count = used_count + 1 WHERE code = :code`,
        { replacements: { code: orderRow.discount_code }, transaction: t }
      );
    }

    // 4. Add confirmation timeline entry
    await OrderTimeline.create(
      {
        orderId,
        status: 'confirmed',
        note: note || `Payment authorized and secured via Paymob (Txn #${transactionId}).`,
      },
      { transaction: t }
    );

    // 5. Clear customer cart upon verified payment
    await CartItem.destroy({
      where: { userId: orderRow.user_id },
      transaction: t,
    });

    await t.commit();

    const fullOrder = await Order.findByPk(orderId, {
      include: [
        { model: OrderItem, as: 'items' },
        { model: OrderTimeline, as: 'timeline' },
      ],
    });
    return { alreadyProcessed: false, success: true, order: formatOrderResponse(fullOrder) };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * Reconciles any orphaned pending Paymob orders for a given user by querying Paymob's live API.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function reconcilePendingPaymobOrders(userId) {
  if (!userId || !isValidUuid(String(userId))) return;
  try {
    const pendingOrders = await Order.findAll({
      where: {
        userId,
        paymentMethod: 'card',
        paymentStatus: 'unpaid',
        status: 'pending',
        paymentReference: { [Op.like]: 'PAYMOB-ORD-%' },
      },
    });

    for (const pending of pendingOrders) {
      const match = pending.paymentReference.match(/^PAYMOB-ORD-(\d+)/);
      if (match && match[1]) {
        const inquiry = await paymobService.inquirePaymobOrder(match[1]);
        if (inquiry.isPaid) {
          console.log(`[Auto-Reconcile] Order ${pending.id} verified as PAID by Paymob.`);
          await fulfillOrderTransactionally({
            orderId: pending.id,
            transactionId: inquiry.transactionId || match[1],
            note: `Payment verified and reconciled with Paymob (Txn #${inquiry.transactionId || match[1]}).`,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Auto-Reconcile Warning]:', err.message);
  }
}

/**
 * Creates and fulfills a new customer order from the active cart within a single ACID transaction.
 * Fixes P1 (ordering order vs stock decrement), P2 (race condition overselling), and P3 (discount limit exceeding).
 *
 * @param {object} user - Authenticated user entity or session user
 * @param {object} orderData - Order payload (addresses, payment, vouchers)
 * @returns {Promise<object>} Created order response matching API contract
 */
async function createOrder(user, orderData = {}) {
  const userId = user.id || user._id;

  // 1. Fetch user's cart items from PostgreSQL
  const cartItems = await CartItem.findAll({
    where: { userId },
    include: [
      { model: Product, as: 'product' },
      { model: ProductVariant, as: 'variant' },
    ],
    order: [
      ['productId', 'ASC'],
      ['variantId', 'ASC'],
    ],
  });

  const lines = cartItems.filter((i) => i.product);
  if (lines.length === 0) {
    const error = new Error('Your cart is empty');
    error.status = 400;
    throw error;
  }

  // 2. Pre-checkout stock verification across all line items (contractual 400 checks)
  for (const item of lines) {
    const prod = item.product;
    const variant = item.variant;
    let availableStock = prod.stock !== undefined ? Number(prod.stock) : 20;

    if (variant && typeof variant.stock === 'number') {
      availableStock = Number(variant.stock);
    }

    if (prod.isAvailable === false || availableStock <= 0) {
      const itemTitle = variant ? `${prod.title} (${variant.name})` : prod.title;
      const error = new Error(`"${itemTitle}" is sold out. Please remove it from your cart to proceed.`);
      error.status = 400;
      throw error;
    }
    if (availableStock < item.quantity) {
      const itemTitle = variant ? `${prod.title} (${variant.name})` : prod.title;
      const error = new Error(
        `Only ${availableStock} pieces of "${itemTitle}" available in studio. Please adjust your quantity.`
      );
      error.status = 400;
      throw error;
    }
  }

  // 3. Prepare line items and calculate subtotal
  const products = lines.map((i) => {
    const prod = i.product.toJSON ? i.product.toJSON() : i.product;
    let variant = null;
    let price = Number(prod.price);

    if (i.variant) {
      const v = i.variant.toJSON ? i.variant.toJSON() : i.variant;
      variant = {
        _id: v.id || v._id,
        id: v.id || v._id,
        name: v.name,
        sku: v.sku,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice !== null && v.compareAtPrice !== undefined ? Number(v.compareAtPrice) : null,
        stock: Number(v.stock),
      };
      if (typeof v.price === 'number') {
        price = Number(v.price);
      }
    }

    return {
      quantity: Number(i.quantity),
      productData: {
        ...prod,
        _id: prod.id || prod._id,
        price,
        userId: prod.sellerId,
        sellerId: prod.sellerId,
      },
      variant,
      productId: prod.id || prod._id,
      variantId: i.variantId || null,
    };
  });

  const subtotal = products.reduce((s, p) => s + p.quantity * (p.variant?.price ?? p.productData.price), 0);

  // 4. Calculate promotional discount voucher
  let discountInfo = {
    code: '',
    discountType: '',
    discountValue: 0,
    amount: 0,
  };

  const discountCode = orderData?.discountCode;
  let discountDoc = null;
  if (discountCode && typeof discountCode === 'string') {
    const cleanCode = discountCode.trim().toUpperCase();
    discountDoc = await Discount.findOne({
      where: { code: cleanCode, isActive: true },
    });

    if (discountDoc) {
      const now = new Date();
      const validDates =
        (!discountDoc.startDate || now >= new Date(discountDoc.startDate)) &&
        (!discountDoc.endDate || now <= new Date(discountDoc.endDate));
      const validUsage = discountDoc.usageLimit === null || discountDoc.usedCount < discountDoc.usageLimit;
      const validMin = subtotal >= Number(discountDoc.minOrderAmount || 0);

      if (validDates && validUsage && validMin) {
        let discountAmt = 0;
        const dVal = Number(discountDoc.discountValue);
        if (discountDoc.discountType === 'percentage') {
          discountAmt = Math.round(subtotal * (dVal / 100) * 100) / 100;
          if (discountDoc.maxDiscount && discountAmt > Number(discountDoc.maxDiscount)) {
            discountAmt = Number(discountDoc.maxDiscount);
          }
        } else {
          discountAmt = Math.min(subtotal, dVal);
        }

        discountInfo = {
          id: discountDoc.id,
          code: discountDoc.code,
          discountType: discountDoc.discountType,
          discountValue: dVal,
          amount: discountAmt,
        };
      }
    }
  }

  const shippingFee = typeof orderData?.shippingFee === 'number' ? Math.max(0, orderData.shippingFee) : 0;
  const totalPrice = Math.max(0, Math.round((subtotal - discountInfo.amount + shippingFee) * 100) / 100);

  const shippingAddress = orderData?.shippingAddress || {};
  const billingAddress = orderData?.billingAddress || shippingAddress;
  const paymentMethod = orderData?.paymentMethod || 'card';
  const isCod = paymentMethod === 'cash_on_delivery';
  const paymentStatus = isCod ? 'unpaid' : (orderData.paymentStatus || 'paid');
  const paymentReference = orderData?.paymentReference || (isCod ? `MOCK-COD-${Date.now()}` : `MOCK-PAY-${Date.now()}`);

  const estimatedDelivery = new Date();
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

  const carrier = orderData?.carrier || 'Aramex White-Glove Express';
  const trackingNumber = orderData?.trackingNumber || `ARX-${Math.floor(100000 + Math.random() * 900000)}-AE`;

  // 5. BEGIN TRANSACTION (ACID Checkout)
  const t = await sequelize.transaction();

  try {
    // 5a. Deadlock Prevention: Sort items deterministically by (productId, variantId)
    const sortedLines = [...lines].sort((a, b) => {
      const pComp = String(a.productId).localeCompare(String(b.productId));
      if (pComp !== 0) return pComp;
      return String(a.variantId || '').localeCompare(String(b.variantId || ''));
    });

    // 5b. Atomic Conditional Stock Decrements
    for (const item of sortedLines) {
      const qty = Number(item.quantity);

      if (item.variantId) {
        const [vRows] = await sequelize.query(
          `UPDATE product_variants 
           SET stock = stock - :qty 
           WHERE id = :variantId AND stock >= :qty 
           RETURNING id`,
          {
            replacements: { qty, variantId: item.variantId },
            transaction: t,
          }
        );
        if (!vRows || vRows.length === 0) {
          const err = new Error(`"${item.product.title} (${item.variant?.name || 'variant'})" is out of stock`);
          err.status = 409;
          throw err;
        }
      }

      const [pRows] = await sequelize.query(
        `UPDATE products 
         SET stock = stock - :qty 
         WHERE id = :productId AND stock >= :qty 
         RETURNING id`,
        {
          replacements: { qty, productId: item.productId },
          transaction: t,
        }
      );
      if (!pRows || pRows.length === 0) {
        const err = new Error(`"${item.product.title}" is out of stock`);
        err.status = 409;
        throw err;
      }
    }

    // 5c. Atomic Conditional Discount Usage Increment
    if (discountDoc && discountInfo.amount > 0) {
      const [dRows] = await sequelize.query(
        `UPDATE discounts 
         SET used_count = used_count + 1 
         WHERE id = :discountId AND is_active = true 
           AND (usage_limit IS NULL OR used_count < usage_limit) 
         RETURNING id`,
        {
          replacements: { discountId: discountDoc.id },
          transaction: t,
        }
      );
      if (!dRows || dRows.length === 0) {
        const err = new Error('Discount usage limit has been reached');
        err.status = 409;
        throw err;
      }
    }

    // 5d. Insert Order
    const order = await Order.create(
      {
        userId,
        userEmail: user.email,
        userName: shippingAddress.name || user.name || '',
        subtotal,
        shippingFee,
        discountCode: discountInfo.code,
        discountType: discountInfo.discountType,
        discountValue: discountInfo.discountValue,
        discountAmount: discountInfo.amount,
        totalPrice,
        status: 'confirmed',
        paymentStatus,
        paymentMethod,
        paymentReference,
        shipName: shippingAddress.name || '',
        shipStreet: shippingAddress.street || '',
        shipCity: shippingAddress.city || '',
        shipCountry: shippingAddress.country || '',
        shipPostalCode: shippingAddress.postalCode || '',
        carrier,
        trackingNumber,
        estimatedDeliveryDate: estimatedDelivery,
        notes: orderData?.billingAddress
          ? `Billing: ${billingAddress.street || ''}, ${billingAddress.city || ''}`
          : (orderData?.notes || ''),
      },
      { transaction: t }
    );

    // 5e. Insert OrderItem snapshot records
    for (const p of products) {
      await OrderItem.create(
        {
          orderId: order.id,
          productId: p.productId,
          variantId: p.variantId,
          productSnapshot: p.productData,
          variantSnapshot: p.variant,
          quantity: p.quantity,
        },
        { transaction: t }
      );
    }

    // 5f. Insert OrderTimeline milestone
    await OrderTimeline.create(
      {
        orderId: order.id,
        status: 'confirmed',
        note: 'Order confirmed and payment secured via encrypted vault.',
      },
      { transaction: t }
    );

    // 5g. Clear user's cart items
    await CartItem.destroy({
      where: { userId },
      transaction: t,
    });

    // 5h. Update User Profile if requested
    const saveToProfile = orderData?.saveToProfile || {};
    if (saveToProfile.saveContactInfo) {
      const updates = {};
      if (shippingAddress.name?.trim()) updates.name = shippingAddress.name.trim();
      if (shippingAddress.phone?.trim()) updates.phone = shippingAddress.phone.trim();
      if (Object.keys(updates).length > 0) {
        await User.update(updates, { where: { id: userId }, transaction: t });
      }
    }

    if (saveToProfile.saveDefaultAddress && shippingAddress.street && shippingAddress.city && shippingAddress.country) {
      const street = shippingAddress.street.trim();
      const city = shippingAddress.city.trim();
      const country = shippingAddress.country.trim();
      const postalCode = shippingAddress.postalCode ? shippingAddress.postalCode.trim() : '';
      const phone = shippingAddress.phone ? shippingAddress.phone.trim() : (user.phone || '');
      const name = shippingAddress.name ? shippingAddress.name.trim() : (user.name || '');

      await Address.update({ isDefault: false }, { where: { userId }, transaction: t });

      const existingAddr = await Address.findOne({
        where: {
          userId,
          street: { [Op.iLike]: street },
          city: { [Op.iLike]: city },
          country: { [Op.iLike]: country },
        },
        transaction: t,
      });

      if (existingAddr) {
        await existingAddr.update(
          { isDefault: true, name, phone, postalCode },
          { transaction: t }
        );
      } else {
        await Address.create(
          {
            userId,
            label: 'Default',
            name,
            street,
            city,
            country,
            postalCode,
            phone,
            isDefault: true,
          },
          { transaction: t }
        );
      }

      await User.update(
        {
          addressStreet: street,
          addressCity: city,
          addressCountry: country,
          addressPostal: postalCode,
        },
        { where: { id: userId }, transaction: t }
      );
    }

    if (saveToProfile.saveDefaultPayment) {
      const updates = {};
      if (['card', 'apple_pay', 'cash_on_delivery'].includes(paymentMethod)) {
        updates.defaultPayment = paymentMethod;
      }
      if (paymentMethod === 'card') {
        const pd = orderData?.paymentDetails || {};
        const rawCard = pd.cardNumber ? String(pd.cardNumber).replace(/\D/g, '') : '';
        const last4 = rawCard ? rawCard.slice(-4) : (user.savedCard?.last4 || '4242');
        let brand = 'Visa';
        if (/^3[47]/.test(rawCard)) brand = 'Amex';
        else if (/^5[1-5]/.test(rawCard)) brand = 'Mastercard';

        updates.savedCard = {
          cardholderName: pd.cardholderName || shippingAddress.name || user.name || '',
          last4,
          brand,
          expiry: pd.expiry || user.savedCard?.expiry || '',
        };
      }
      if (Object.keys(updates).length > 0) {
        await User.update(updates, { where: { id: userId }, transaction: t });
      }
    }

    // COMMIT TRANSACTION
    await t.commit();

    return getOrderById(order.id);
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * Retrieves past orders for a user, sorted descending by order creation.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
async function getUserOrders(userId) {
  if (!userId) return [];
  await reconcilePendingPaymobOrders(userId);

  const orders = await Order.findAll({
    where: {
      userId,
      [Op.not]: [{ paymentMethod: 'card', paymentStatus: 'unpaid', status: 'pending' }],
    },
    include: [
      { model: OrderItem, as: 'items' },
      { model: OrderTimeline, as: 'timeline' },
    ],
    order: [['createdAt', 'DESC']],
  });

  return orders.map(formatOrderResponse);
}

/**
 * Finds an order by its ID with items and timeline.
 *
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
async function getOrderById(orderId) {
  if (!orderId || !isValidUuid(String(orderId))) return null;

  const order = await Order.findByPk(orderId, {
    include: [
      { model: OrderItem, as: 'items' },
      { model: OrderTimeline, as: 'timeline' },
    ],
  });

  if (!order) return null;
  return formatOrderResponse(order);
}

module.exports = {
  createOrder,
  getUserOrders,
  getOrderById,
  reconcilePendingPaymobOrders,
  fulfillOrderTransactionally,
  formatOrderResponse,
  isValidUuid,
};
