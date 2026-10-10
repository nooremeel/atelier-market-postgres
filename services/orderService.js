/**
 * @file services/orderService.js
 * @description Domain logic for orders: order creation from cart, inventory decrementing,
 *              discount voucher application, Paymob reconciliation, and order retrieval.
 */

const Order = require('../models/order');
const Product = require('../models/product');
const Discount = require('../models/discount');
const User = require('../models/user');
const paymobService = require('./paymobService');

/**
 * Reconciles any orphaned pending Paymob orders for a given user by querying Paymob's live API.
 *
 * @param {string|object} userId
 * @returns {Promise<void>}
 */
async function reconcilePendingPaymobOrders(userId) {
  if (!userId) return;
  try {
    const mongoose = require('mongoose');
    if (typeof userId === 'string' && !mongoose.Types.ObjectId.isValid(userId)) {
      return;
    }
    const pendingOrders = await Order.find({
      'user.userId': userId,
      paymentMethod: 'card',
      paymentStatus: 'unpaid',
      status: 'pending',
      paymentReference: { $regex: /^PAYMOB-ORD-/ },
    });

    for (const pending of pendingOrders) {
      const match = pending.paymentReference.match(/^PAYMOB-ORD-(\d+)/);
      if (match && match[1]) {
        const inquiry = await paymobService.inquirePaymobOrder(match[1]);
        if (inquiry.isPaid) {
          console.log(`[Auto-Reconcile] Order ${pending._id} verified as PAID by Paymob.`);
          pending.paymentStatus = 'paid';
          pending.status = 'confirmed';
          pending.paymentReference = `PAYMOB-TXN-${inquiry.transactionId || match[1]}`;
          pending.timeline.push({
            status: 'confirmed',
            timestamp: new Date(),
            note: `Payment verified and reconciled with Paymob (Txn #${inquiry.transactionId || match[1]}).`,
          });

          // Decrement inventory stock
          for (const item of pending.products) {
            const prodId = item.productData?._id;
            const variantId = item.variant?._id;
            if (prodId && variantId) {
              await Product.updateOne(
                { _id: prodId, 'variants._id': variantId },
                { $inc: { 'variants.$.stock': -item.quantity, stock: -item.quantity } }
              );
            } else if (prodId) {
              await Product.findByIdAndUpdate(prodId, { $inc: { stock: -item.quantity } });
            }
          }

          if (pending.discount?.code) {
            await Discount.updateOne({ code: pending.discount.code }, { $inc: { usedCount: 1 } });
          }

          await pending.save();

          const user = await User.findById(userId);
          if (user) {
            await user.clearCart();
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Auto-Reconcile Warning]:', err.message);
  }
}

/**
 * Creates and fulfills a new customer order from the active cart.
 *
 * @param {import('../models/user').UserDocument} user - Authenticated user document.
 * @param {object} orderData - Request body containing shipping, payment, discount, and profile options.
 * @returns {Promise<import('../models/order').OrderDocument>} Created order document.
 */
async function createOrder(user, orderData = {}) {
  const populatedUser = await user.populate('cart.items.productId');
  const lines = populatedUser.cart.items.filter((i) => i.productId);
  if (lines.length === 0) {
    const error = new Error('Your cart is empty');
    error.status = 400;
    throw error;
  }

  // Stock verification across all line items
  for (const item of lines) {
    const prod = item.productId;
    const variantIdStr = item.variantId ? item.variantId.toString() : null;
    let variant = null;
    let availableStock = prod.stock !== undefined ? prod.stock : 20;

    if (variantIdStr && Array.isArray(prod.variants)) {
      variant = prod.variants.find((v) => v._id.toString() === variantIdStr);
      if (variant && typeof variant.stock === 'number') {
        availableStock = variant.stock;
      }
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

  const products = lines.map((i) => {
    const prod = i.productId;
    const variantIdStr = i.variantId ? i.variantId.toString() : null;
    let variant = null;
    let price = prod.price;

    if (variantIdStr && Array.isArray(prod.variants)) {
      const found = prod.variants.find((v) => v._id.toString() === variantIdStr);
      if (found) {
        variant = {
          _id: found._id,
          name: found.name,
          sku: found.sku,
          price: found.price,
          compareAtPrice: found.compareAtPrice,
          stock: found.stock,
        };
        if (typeof found.price === 'number') {
          price = found.price;
        }
      }
    }

    return {
      quantity: i.quantity,
      productData: { ...prod._doc, price },
      variant,
    };
  });

  const subtotal = products.reduce((s, p) => s + p.quantity * (p.variant?.price ?? p.productData.price), 0);

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
    discountDoc = await Discount.findOne({ code: cleanCode, isActive: true });
    if (discountDoc) {
      const now = new Date();
      const validDates =
        (!discountDoc.startDate || now >= discountDoc.startDate) &&
        (!discountDoc.endDate || now <= discountDoc.endDate);
      const validUsage = discountDoc.usageLimit === null || discountDoc.usedCount < discountDoc.usageLimit;
      const validMin = subtotal >= discountDoc.minOrderAmount;

      if (validDates && validUsage && validMin) {
        let discountAmt = 0;
        if (discountDoc.discountType === 'percentage') {
          discountAmt = Math.round(subtotal * (discountDoc.discountValue / 100) * 100) / 100;
          if (discountDoc.maxDiscount && discountAmt > discountDoc.maxDiscount) {
            discountAmt = discountDoc.maxDiscount;
          }
        } else {
          discountAmt = Math.min(subtotal, discountDoc.discountValue);
        }

        discountInfo = {
          code: discountDoc.code,
          discountType: discountDoc.discountType,
          discountValue: discountDoc.discountValue,
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
  const paymentStatus = isCod ? 'unpaid' : 'paid';
  const paymentReference = orderData?.paymentReference || (isCod ? `MOCK-COD-${Date.now()}` : `MOCK-PAY-${Date.now()}`);

  const estimatedDelivery = new Date();
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

  const initialTimeline = [
    {
      status: 'confirmed',
      timestamp: new Date(),
      note: 'Order confirmed and payment secured via encrypted vault.',
    },
  ];

  const carrier = orderData?.carrier || 'Aramex White-Glove Express';
  const trackingNumber = orderData?.trackingNumber || `ARX-${Math.floor(100000 + Math.random() * 900000)}-AE`;

  const order = new Order({
    user: {
      email: user.email,
      userId: user._id,
      name: shippingAddress.name || user.name || '',
    },
    products,
    subtotal,
    shippingFee,
    discount: discountInfo,
    totalPrice,
    shippingAddress: {
      name: shippingAddress.name || '',
      street: shippingAddress.street || '',
      city: shippingAddress.city || '',
      country: shippingAddress.country || '',
      postalCode: shippingAddress.postalCode || '',
    },
    paymentMethod,
    paymentStatus,
    paymentReference,
    status: 'confirmed',
    carrier,
    trackingNumber,
    estimatedDeliveryDate: estimatedDelivery,
    timeline: initialTimeline,
    notes: orderData?.billingAddress ? `Billing: ${billingAddress.street || ''}, ${billingAddress.city || ''}` : '',
  });

  const saved = await order.save();

  // Decrement stock for purchased items
  for (const item of lines) {
    const variantIdStr = item.variantId ? item.variantId.toString() : null;
    if (variantIdStr) {
      await Product.updateOne(
        { _id: item.productId._id, 'variants._id': item.variantId },
        {
          $inc: {
            'variants.$.stock': -item.quantity,
            stock: -item.quantity,
          },
        }
      );
    } else {
      await Product.findByIdAndUpdate(item.productId._id, {
        $inc: { stock: -item.quantity },
      });
    }
  }

  if (discountDoc && discountInfo.amount > 0) {
    discountDoc.usedCount += 1;
    await discountDoc.save();
  }

  await user.clearCart();

  // Handle saving customer details to user profile
  const saveToProfile = orderData?.saveToProfile || {};
  let shouldSaveUser = false;

  if (saveToProfile.saveContactInfo) {
    if (shippingAddress.name && typeof shippingAddress.name === 'string' && shippingAddress.name.trim()) {
      user.name = shippingAddress.name.trim();
      shouldSaveUser = true;
    }
    if (shippingAddress.phone && typeof shippingAddress.phone === 'string' && shippingAddress.phone.trim()) {
      user.phone = shippingAddress.phone.trim();
      shouldSaveUser = true;
    }
  }

  if (saveToProfile.saveDefaultAddress && shippingAddress.street && shippingAddress.city && shippingAddress.country) {
    const street = shippingAddress.street.trim();
    const city = shippingAddress.city.trim();
    const country = shippingAddress.country.trim();
    const postalCode = shippingAddress.postalCode ? shippingAddress.postalCode.trim() : '';
    const phone = shippingAddress.phone ? shippingAddress.phone.trim() : (user.phone || '');
    const name = shippingAddress.name ? shippingAddress.name.trim() : (user.name || '');

    if (!Array.isArray(user.addresses)) {
      user.addresses = [];
    }

    user.addresses.forEach((a) => {
      a.isDefault = false;
    });

    const existing = user.addresses.find((a) =>
      a.street?.trim().toLowerCase() === street.toLowerCase() &&
      a.city?.trim().toLowerCase() === city.toLowerCase() &&
      a.country?.trim().toLowerCase() === country.toLowerCase()
    );

    if (existing) {
      existing.isDefault = true;
      if (name) existing.name = name;
      if (phone) existing.phone = phone;
      if (postalCode) existing.postalCode = postalCode;
    } else {
      user.addresses.push({
        label: 'Default',
        name,
        street,
        city,
        country,
        postalCode,
        phone,
        isDefault: true,
      });
    }

    user.address = { street, city, country, postalCode };
    shouldSaveUser = true;
  }

  if (saveToProfile.saveDefaultPayment) {
    if (['card', 'apple_pay', 'cash_on_delivery'].includes(paymentMethod)) {
      user.defaultPaymentMethod = paymentMethod;
      shouldSaveUser = true;
    }
    if (paymentMethod === 'card') {
      const pd = orderData?.paymentDetails || {};
      const rawCard = pd.cardNumber ? String(pd.cardNumber).replace(/\D/g, '') : '';
      const last4 = rawCard ? rawCard.slice(-4) : (user.savedCard?.last4 || '4242');
      let brand = 'Visa';
      if (/^3[47]/.test(rawCard)) brand = 'Amex';
      else if (/^5[1-5]/.test(rawCard)) brand = 'Mastercard';

      user.savedCard = {
        cardholderName: pd.cardholderName || shippingAddress.name || user.name || '',
        last4,
        brand,
        expiry: pd.expiry || user.savedCard?.expiry || '',
      };
      shouldSaveUser = true;
    }
  }

  if (shouldSaveUser) {
    await user.save();
  }

  return saved;
}

/**
 * Retrieves past orders for a user, sorted descending by order creation.
 *
 * @param {string|object} userId
 * @returns {Promise<Array<import('../models/order').OrderDocument>>}
 */
async function getUserOrders(userId) {
  await reconcilePendingPaymobOrders(userId);
  return Order.find({
    'user.userId': userId,
    $nor: [{ paymentMethod: 'card', paymentStatus: 'unpaid', status: 'pending' }],
  }).sort({ _id: -1 });
}

/**
 * Finds an order by its ID.
 *
 * @param {string} orderId
 * @returns {Promise<import('../models/order').OrderDocument|null>}
 */
async function getOrderById(orderId) {
  return Order.findById(orderId);
}

module.exports = {
  reconcilePendingPaymobOrders,
  createOrder,
  getUserOrders,
  getOrderById,
};
