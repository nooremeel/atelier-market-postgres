/**
 * @file services/cartService.js
 * @description Domain logic for customer shopping cart: serialization, variant handling,
 *              inventory scarcity checks, and line item mutations using PostgreSQL cart_items.
 */

const { CartItem, Product, ProductVariant } = require('../db/models');

/**
 * Serializes a list of CartItem records with unit pricing, variant information, and inventory limits.
 *
 * @param {Array<CartItem>} cartItems - Array of CartItem instances with included Product and ProductVariant.
 * @returns {{ items: Array, totalItems: number, totalPrice: number }}
 */
function serializeCart(cartItems = []) {
  if (!Array.isArray(cartItems)) {
    return { items: [], totalItems: 0, totalPrice: 0 };
  }

  const items = cartItems
    .filter((i) => i.product)
    .map((i) => {
      const prod = i.product.toJSON ? i.product.toJSON() : i.product;
      const variantIdStr = i.variantId ? String(i.variantId) : null;
      let variant = null;
      let unitPrice = Number(prod.price);
      let availableStock = prod.stock !== undefined ? Number(prod.stock) : 20;

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
        unitPrice = Number(v.price);
        availableStock = Number(v.stock);
      }

      return {
        _id: i.id || i._id,
        id: i.id || i._id,
        product: prod,
        productId: prod.id || prod._id,
        quantity: Number(i.quantity),
        variantId: variantIdStr,
        variant,
        unitPrice,
        stock: availableStock,
      };
    });

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce(
    (s, i) => s + i.quantity * (i.unitPrice !== undefined ? i.unitPrice : Number(i.product.price)),
    0
  );

  return { items, totalItems, totalPrice: Math.round(totalPrice * 100) / 100 };
}

/**
 * Retrieves the current user's cart populated with product and variant references.
 *
 * @param {object} user
 * @returns {Promise<{ items: Array, totalItems: number, totalPrice: number }>}
 */
async function getCart(user) {
  const userId = user.id || user._id;
  const cartItems = await CartItem.findAll({
    where: { userId },
    include: [
      { model: Product, as: 'product' },
      { model: ProductVariant, as: 'variant' },
    ],
    order: [['id', 'ASC']],
  });
  return serializeCart(cartItems);
}

/**
 * Adds an item (and optional variant) to the user's cart, verifying stock limits.
 *
 * @param {object} user
 * @param {object} params
 * @param {string} params.productId
 * @param {string} [params.variantId]
 * @param {number} [params.quantity=1]
 * @returns {Promise<{ items: Array, totalItems: number, totalPrice: number }>}
 */
async function addToCart(user, { productId, variantId, quantity }) {
  const userId = user.id || user._id;
  const product = await Product.findByPk(productId, {
    include: [{ model: ProductVariant, as: 'variants' }],
  });
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const addQty = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  let selectedVariant = null;
  let availableStock = product.stock !== undefined ? Number(product.stock) : 20;

  const variantIdStr = variantId ? String(variantId) : null;
  if (variantIdStr) {
    selectedVariant = (product.variants || []).find(
      (v) => (v.id || v._id).toString() === variantIdStr
    );
    if (!selectedVariant) {
      selectedVariant = await ProductVariant.findByPk(variantIdStr);
    }
    if (!selectedVariant) {
      const error = new Error('Selected variant not found');
      error.status = 400;
      throw error;
    }
    if (typeof selectedVariant.stock === 'number') {
      availableStock = Number(selectedVariant.stock);
    }
  }

  if (availableStock <= 0 || product.isAvailable === false) {
    const error = new Error('This handcrafted item is currently sold out');
    error.status = 400;
    throw error;
  }

  const existing = await CartItem.findOne({
    where: {
      userId,
      productId: product.id,
      variantId: variantIdStr || null,
    },
  });

  const currentQty = existing ? Number(existing.quantity) : 0;
  if (currentQty + addQty > availableStock) {
    const error = new Error(`Only ${availableStock} pieces available in studio`);
    error.status = 400;
    throw error;
  }

  if (existing) {
    existing.quantity = currentQty + addQty;
    await existing.save();
  } else {
    await CartItem.create({
      userId,
      productId: product.id,
      variantId: variantIdStr || null,
      quantity: addQty,
    });
  }

  return getCart(user);
}

/**
 * Removes a product line item entirely from the user's cart.
 *
 * @param {object} user
 * @param {object} params
 * @param {string} params.productId
 * @param {string} [params.variantId]
 * @returns {Promise<{ items: Array, totalItems: number, totalPrice: number }>}
 */
async function removeFromCart(user, { productId, variantId }) {
  const userId = user.id || user._id;
  const pId = productId?._id || productId?.id || productId;
  const vId = variantId ? String(variantId) : null;

  const whereClause = {
    userId,
    productId: pId,
  };
  if (vId) {
    whereClause.variantId = vId;
  } else {
    whereClause.variantId = null;
  }

  await CartItem.destroy({ where: whereClause });
  return getCart(user);
}

/**
 * Decrements an item's quantity in the cart or removes it if quantity reaches 0.
 *
 * @param {object} user
 * @param {object} params
 * @param {string} params.productId
 * @param {string} [params.variantId]
 * @returns {Promise<{ items: Array, totalItems: number, totalPrice: number }>}
 */
async function decrementCartItem(user, { productId, variantId }) {
  const userId = user.id || user._id;
  const pId = productId?._id || productId?.id || productId;
  const vId = variantId ? String(variantId) : null;

  const whereClause = {
    userId,
    productId: pId,
  };
  if (vId) {
    whereClause.variantId = vId;
  } else {
    whereClause.variantId = null;
  }

  const existing = await CartItem.findOne({ where: whereClause });
  if (!existing) {
    return getCart(user);
  }

  if (existing.quantity > 1) {
    existing.quantity -= 1;
    await existing.save();
  } else {
    await existing.destroy();
  }

  return getCart(user);
}

/**
 * Clears all items from the user's cart.
 *
 * @param {object} user
 * @returns {Promise<{ items: Array, totalItems: number, totalPrice: number }>}
 */
async function clearCart(user) {
  const userId = user.id || user._id;
  await CartItem.destroy({ where: { userId } });
  return { items: [], totalItems: 0, totalPrice: 0 };
}

module.exports = {
  serializeCart,
  getCart,
  addToCart,
  removeFromCart,
  decrementCartItem,
  clearCart,
};
