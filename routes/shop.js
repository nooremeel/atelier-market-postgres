const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const productsController = require('../controllers/products');
const cartController = require('../controllers/cart');
const ordersController = require('../controllers/orders');
const isCustomerOrAdmin = require('../middleware/require-role')('customer', 'admin');

const validateProductId = [
  body('productId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Invalid product'),
];

// Product catalog routes
router.get('/products', productsController.getProducts);
router.get('/products/:productId', productsController.getProduct);

// Cart routes
router.get('/cart', isCustomerOrAdmin, cartController.getCart);
router.post('/cart', isCustomerOrAdmin, validateProductId, cartController.postCart);
router.post('/cart/delete', isCustomerOrAdmin, validateProductId, cartController.postCartDeleteProduct);
router.post('/cart/decrement', isCustomerOrAdmin, validateProductId, cartController.postCartDecrement);
router.get('/checkout', isCustomerOrAdmin, cartController.getCheckout);

// Order routes
router.post('/orders', isCustomerOrAdmin, ordersController.postOrder);
router.get('/orders', isCustomerOrAdmin, ordersController.getOrders);
router.get('/orders/:orderId/invoice', isCustomerOrAdmin, ordersController.getInvoice);

module.exports = router;
