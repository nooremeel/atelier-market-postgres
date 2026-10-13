const express = require('express');
const router = express.Router();
const paymobService = require('../services/paymobService');
const {
  fulfillOrderTransactionally,
  isValidUuid,
  getOrderById,
} = require('../services/orderService');
const {
  Order,
  OrderItem,
  OrderTimeline,
  Product,
  ProductVariant,
  CartItem,
  Discount,
  User,
} = require('../db/models');
const isCustomerOrAdmin = require('../middleware/require-role')('customer', 'admin');

/**
 * Helper: Resolve the client SPA base URL dynamically across local dev, staging, and production deployments.
 */
function getFrontendBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host && (host.includes('localhost:3001') || host.includes('127.0.0.1:3001'))) {
    return 'http://localhost:5173';
  }
  if (host) {
    return `${proto}://${host}`;
  }
  return 'http://localhost:5173';
}

/**
 * POST /api/paymob/initiate
 * Authenticated endpoint: customer initiates a checkout with Paymob.
 * Validates stock, calculates pricing, creates a 'pending' order in PostgreSQL,
 * and requests a Payment Key / iFrame URL from Paymob.
 */
router.post('/initiate', isCustomerOrAdmin, async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;

    // 1. Fetch user's cart from PostgreSQL
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
      return res.status(400).json({ message: 'Your cart is empty' });
    }

    // 2. Stock verification across all line items
    for (const item of lines) {
      const prod = item.product;
      const variant = item.variant;
      let availableStock = prod.stock !== undefined ? Number(prod.stock) : 20;

      if (variant && typeof variant.stock === 'number') {
        availableStock = Number(variant.stock);
      }

      if (prod.isAvailable === false || availableStock <= 0) {
        const itemTitle = variant ? `${prod.title} (${variant.name})` : prod.title;
        return res.status(400).json({
          message: `"${itemTitle}" is sold out. Please remove it from your cart to proceed.`,
        });
      }
      if (availableStock < item.quantity) {
        const itemTitle = variant ? `${prod.title} (${variant.name})` : prod.title;
        return res.status(400).json({
          message: `Only ${availableStock} pieces of "${itemTitle}" available. Please adjust your quantity.`,
        });
      }
    }

    // 3. Prepare items and compute pricing
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

    // 4. Calculate discount voucher
    let discountInfo = {
      code: '',
      discountType: '',
      discountValue: 0,
      amount: 0,
    };

    const discountCode = req.body?.discountCode;
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

    const shippingFee = typeof req.body?.shippingFee === 'number' ? Math.max(0, req.body.shippingFee) : 0;
    const totalPrice = Math.max(0, Math.round((subtotal - discountInfo.amount + shippingFee) * 100) / 100);

    const shippingAddress = req.body?.shippingAddress || {};
    const billingAddress = req.body?.billingAddress || shippingAddress;
    const carrier = req.body?.carrier || 'White-Glove Express';
    const trackingNumber = `PAYMOB-${Math.floor(100000 + Math.random() * 900000)}-US`;

    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

    // 5. Create Order with 'pending' status and 'unpaid' paymentStatus
    const order = await Order.create({
      userId,
      userEmail: req.user.email,
      userName: shippingAddress.name || req.user.name || '',
      subtotal,
      shippingFee,
      discountCode: discountInfo.code,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.amount,
      totalPrice,
      paymentMethod: 'card',
      paymentStatus: 'unpaid',
      paymentReference: '',
      status: 'pending',
      shipName: shippingAddress.name || '',
      shipStreet: shippingAddress.street || '',
      shipCity: shippingAddress.city || '',
      shipCountry: shippingAddress.country || '',
      shipPostalCode: shippingAddress.postalCode || '',
      carrier,
      trackingNumber,
      estimatedDeliveryDate: estimatedDelivery,
      notes: billingAddress ? `Billing: ${billingAddress.street || ''}, ${billingAddress.city || ''}` : '',
    });

    for (const p of products) {
      await OrderItem.create({
        orderId: order.id,
        productId: p.productId,
        variantId: p.variantId,
        productSnapshot: p.productData,
        variantSnapshot: p.variant,
        quantity: p.quantity,
      });
    }

    await OrderTimeline.create({
      orderId: order.id,
      status: 'pending',
      note: 'Order initiated. Awaiting payment authorization via Paymob Gateway.',
    });

    // 6. Contact Paymob via 3-step service pipeline
    const paymentSession = await paymobService.createCardPaymentSession({
      orderId: order.id.toString(),
      totalPrice,
      currency: process.env.PAYMOB_CURRENCY || 'USD',
      billingData: {
        name: shippingAddress.name || req.user.name || 'Patron',
        email: req.user.email,
        phone: shippingAddress.phone || req.user.phone || '+12025550123',
        street: shippingAddress.street || 'NA',
        city: shippingAddress.city || 'New York',
        country: shippingAddress.country || 'US',
        postalCode: shippingAddress.postalCode || '10001',
      },
      items: products,
    });

    order.paymentReference = `PAYMOB-ORD-${paymentSession.paymobOrderId}`;
    await order.save();

    if (paymentSession.isSimulation) {
      console.warn(
        '[Paymob Initiate] WARNING: Server running in OFFLINE SIMULATION MODE. No requests sent to Paymob.'
      );
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      totalPrice: Number(order.totalPrice),
      currency: paymentSession.currency,
      iframeUrl: paymentSession.iframeUrl,
      paymentToken: paymentSession.paymentToken,
      isSimulation: paymentSession.isSimulation,
    });
  } catch (err) {
    console.error('[Paymob Initiate Error]:', err);
    next(err);
  }
});

/**
 * POST /api/paymob/pay
 * Authenticated endpoint: Direct card payment processing via Paymob financial rail.
 */
router.post('/pay', isCustomerOrAdmin, async (req, res, next) => {
  try {
    const { orderId, paymentToken, card } = req.body;

    if (!orderId || !paymentToken || !card) {
      return res.status(400).json({ message: 'Missing required card payment parameters.' });
    }

    if (!isValidUuid(orderId)) {
      return res.status(404).json({ message: 'Active pending order not found.' });
    }

    const userId = req.user.id || req.user._id;
    const order = await Order.findOne({
      where: {
        id: orderId,
        userId,
        status: 'pending',
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Active pending order not found.' });
    }

    const billingData = {
      name: card.holderName || order.shipName || req.user.name,
      email: req.user.email,
      phone: req.user.phone || '+201000000000',
      street: order.shipStreet || 'NA',
      city: order.shipCity || 'Cairo',
      country: order.shipCountry || 'EG',
      postalCode: order.shipPostalCode || 'NA',
    };

    const result = await paymobService.processDirectCardPayment({
      paymentToken,
      cardData: card,
      billingData,
    });

    if (result.requires3ds && result.redirectionUrl) {
      return res.json({
        success: true,
        requires3ds: true,
        redirectionUrl: result.redirectionUrl,
      });
    }

    if (result.success) {
      const fulfillment = await fulfillOrderTransactionally({
        orderId,
        transactionId: result.transactionId || Date.now(),
        note: `Payment authorized via Paymob (Txn #${result.transactionId || 'DIRECT'}).`,
      });

      return res.json({
        success: true,
        requires3ds: false,
        orderId: order.id,
        order: fulfillment.order,
      });
    }

    return res.status(400).json({
      success: false,
      message: result.message || 'Payment could not be authorized.',
    });
  } catch (err) {
    console.error('[Paymob Direct Pay Error]:', err.message);
    return res.status(400).json({
      success: false,
      message: err.message || 'Unable to process card payment with Paymob.',
    });
  }
});

/**
 * POST /api/paymob/webhook
 * Unauthenticated / Server-to-Server endpoint:
 * Paymob posts transaction result here.
 * Secured by HMAC-SHA512 verification (no CSRF cookie).
 * 100% IDEMPOTENT via fulfillOrderTransactionally().
 */
router.post('/webhook', async (req, res) => {
  try {
    const receivedHmac = req.query.hmac || req.headers['x-paymob-hmac'] || req.body?.hmac;
    const transactionObj = req.body?.obj;

    console.log('[Paymob Webhook] Received callback for transaction:', transactionObj?.id);

    // 1. Verify cryptographic HMAC signature
    const isValidSignature = paymobService.verifyHmacSignature(transactionObj, receivedHmac);
    if (!isValidSignature) {
      console.error('[Paymob Webhook] Invalid HMAC signature detected! Rejecting request.');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const isSuccess = transactionObj?.success === true;
    const merchantOrderId = transactionObj?.order?.merchant_order_id;
    const transactionId = transactionObj?.id;

    if (!merchantOrderId || !isValidUuid(merchantOrderId)) {
      console.warn('[Paymob Webhook] Missing or invalid merchant_order_id in payload.');
      return res.status(400).json({ message: 'Missing order reference' });
    }

    const existingOrder = await Order.findByPk(merchantOrderId);
    if (!existingOrder) {
      console.warn(`[Paymob Webhook] Order not found for ID: ${merchantOrderId}`);
      return res.status(404).json({ message: 'Order not found' });
    }

    // 2. Process Success: 100% Idempotent fulfillment
    if (isSuccess) {
      const fulfillment = await fulfillOrderTransactionally({
        orderId: merchantOrderId,
        transactionId,
        note: `Payment authorized and secured via Paymob 3D-Secure (Txn #${transactionId}).`,
      });

      if (fulfillment.alreadyProcessed) {
        console.log(`[Paymob Webhook] Order ${merchantOrderId} already fulfilled. Returning 200.`);
        return res.status(200).json({ message: 'Order already fulfilled' });
      }

      console.log(`[Paymob Webhook] Order ${merchantOrderId} fulfilled successfully.`);
    } else {
      console.log(`[Paymob Webhook] Payment failed for Order ${merchantOrderId}. Marking cancelled.`);
      await Order.update(
        { paymentStatus: 'unpaid', status: 'cancelled' },
        { where: { id: merchantOrderId } }
      );
      await OrderTimeline.create({
        orderId: merchantOrderId,
        status: 'cancelled',
        note: `Payment rejected by gateway: ${transactionObj?.data?.message || 'Transaction declined'}.`,
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Paymob Webhook Processing Error]:', err);
    return res.status(500).json({ message: 'Internal processing error' });
  }
});

/**
 * POST /api/paymob/simulate-success
 * Sandbox helper for local testing: simulates receiving a successful webhook.
 */
router.post('/simulate-success', isCustomerOrAdmin, async (req, res) => {
  if (!paymobService.isSimulationMode()) {
    return res.status(403).json({ message: 'Simulation endpoint disabled in live mode' });
  }

  const { orderId } = req.body;
  if (!isValidUuid(orderId)) {
    return res.status(404).json({ message: 'Order not found' });
  }

  const fulfillment = await fulfillOrderTransactionally({
    orderId,
    transactionId: Date.now(),
    note: 'Payment authorized and secured via Paymob Sandbox 3D-Secure simulation.',
  });

  if (fulfillment.notFound) {
    return res.status(404).json({ message: 'Order not found' });
  }

  return res.json({ success: true, order: fulfillment.order });
});

/**
 * POST /api/paymob/cancel
 * Customer closed or dismissed the Paymob payment modal without paying.
 * Removes the unconfirmed pending order draft so it never shows up in their order history.
 */
router.post('/cancel', isCustomerOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId || !isValidUuid(orderId)) {
      return res.status(400).json({ message: 'Missing orderId' });
    }

    const userId = req.user.id || req.user._id;
    const deleted = await Order.destroy({
      where: {
        id: orderId,
        userId,
        status: 'pending',
        paymentStatus: 'unpaid',
      },
    });

    if (deleted) {
      console.log(`[Paymob Cancel] Removed unconfirmed draft order ${orderId}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Paymob Cancel Error]:', err);
    next(err);
  }
});

/**
 * ALL /api/paymob/callback
 * Paymob Transaction Response Callback (Browser Redirection after 3DS).
 */
router.all('/callback', async (req, res) => {
  const frontendUrl = getFrontendBaseUrl(req);
  try {
    const rawPayload = req.method === 'POST' ? (req.body?.obj || req.body || {}) : req.query;
    const isSuccess =
      rawPayload.success === 'true' ||
      rawPayload.success === true ||
      rawPayload.txn_response_code === 'APPROVED';

    const merchantOrderId =
      rawPayload.merchant_order_id ||
      rawPayload['order.merchant_order_id'] ||
      rawPayload.order?.merchant_order_id ||
      rawPayload.order_id;

    const txnId = rawPayload.id || rawPayload.transaction_id;
    const rawMessage =
      rawPayload['data.message'] ||
      rawPayload.message ||
      rawPayload.data?.message ||
      (isSuccess ? 'Payment approved' : 'Payment was declined or cancelled');

    const isCancelled =
      rawPayload.txn_response_code === 'CANCELLED' ||
      rawMessage.toLowerCase().includes('cancel') ||
      rawPayload.cancelled === 'true' ||
      rawPayload.cancelled === true;

    console.log(
      `[Paymob Response Callback] Browser redirect: Order=${merchantOrderId}, Success=${isSuccess}, Txn=${txnId}`
    );

    if (merchantOrderId && isValidUuid(merchantOrderId)) {
      if (isSuccess) {
        await fulfillOrderTransactionally({
          orderId: merchantOrderId,
          transactionId: txnId || Date.now(),
          note: `Payment authorized via Paymob 3D-Secure redirection (Txn #${txnId || 'CALLBACK'}).`,
        });
      } else {
        await OrderTimeline.create({
          orderId: merchantOrderId,
          status: 'pending',
          note: `Payment attempt declined or cancelled via gateway callback: ${rawMessage}.`,
        });
      }
    }

    if (isSuccess) {
      return res.redirect(
        `${frontendUrl}/orders?payment=success&orderId=${merchantOrderId || ''}&txn=${txnId || ''}`
      );
    } else if (isCancelled) {
      return res.redirect(`${frontendUrl}/checkout?payment=cancelled`);
    } else {
      const msg = encodeURIComponent(rawMessage);
      return res.redirect(`${frontendUrl}/checkout?payment=declined&message=${msg}`);
    }
  } catch (err) {
    console.error('[Paymob Callback Redirection Error]:', err);
    return res.redirect(`${frontendUrl}/orders`);
  }
});

module.exports = router;
