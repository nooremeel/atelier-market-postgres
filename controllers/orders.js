/**
 * @file controllers/orders.js
 * @description Thin controller for order placement, order history, and official PDF invoice
 *              streaming. Delegates business logic to orderService.
 */

const orderService = require('../services/orderService');
const { generateInvoicePdf } = require('../util/invoiceGenerator');

/**
 * POST /api/orders
 * Places an order from the authenticated user's cart.
 */
exports.postOrder = async (req, res, next) => {
  try {
    const saved = await orderService.createOrder(req.user, req.body);
    return res.status(201).json({
      order: {
        _id: saved._id,
        subtotal: saved.subtotal,
        shippingFee: saved.shippingFee,
        discount: saved.discount,
        totalPrice: saved.totalPrice,
        products: saved.products,
        shippingAddress: saved.shippingAddress,
        paymentMethod: saved.paymentMethod,
        paymentStatus: saved.paymentStatus,
        paymentReference: saved.paymentReference,
        status: saved.status,
        carrier: saved.carrier,
        trackingNumber: saved.trackingNumber,
        estimatedDeliveryDate: saved.estimatedDeliveryDate,
        timeline: saved.timeline,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * GET /api/orders
 * Returns customer order history.
 */
exports.getOrders = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const orders = await orderService.getUserOrders(userId);
    return res.json({ orders });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders/:orderId/invoice
 * Streams generated PDF invoice to response.
 */
exports.getInvoice = async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    const order = await orderService.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const currentUserId = (req.user.id || req.user._id).toString();
    const orderUserId = (order.user?.userId || order.userId).toString();
    const isOwner = orderUserId === currentUserId;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const invoiceName = `invoice-${orderId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceName}"`);

    generateInvoicePdf(order, res);
  } catch (err) {
    next(err);
  }
};
