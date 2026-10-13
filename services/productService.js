/**
 * @file services/productService.js
 * @description Domain logic for catalog pieces: filtering, pagination, PostgreSQL full-text
 *              search via tsvector and GIN, sorting, product detail retrieval, and seller/admin
 *              product management.
 */

const { Product, ProductVariant, User, SellerProfile } = require('../db/models');
const { sequelize, Sequelize } = require('../db');
const { Op } = Sequelize;
const fileHelper = require('../util/file');

const ITEMS_PER_PAGE = 6;

const SORTS = {
  price_asc:  [['price', 'ASC'], ['id', 'DESC']],
  price_desc: [['price', 'DESC'], ['id', 'DESC']],
  title_asc:  [['title', 'ASC'], ['id', 'DESC']],
  newest:     [['createdAt', 'DESC'], ['id', 'DESC']],
  rating:     [['ratingAverage', 'DESC'], ['ratingCount', 'DESC'], ['id', 'DESC']],
};

/**
 * Builds where conditions and order from request query parameters.
 *
 * @param {object} query - Express req.query object.
 * @returns {{ where: object, order: Array }}
 */
function buildProductFilter(query = {}) {
  const q         = (query.q || '').trim();
  const category  = (query.category || '').trim();
  const badge     = (query.badge || '').trim();
  const sellerId  = (query.sellerId || '').trim();
  const minPrice  = query.minPrice !== undefined && query.minPrice !== '' ? Number(query.minPrice) : undefined;
  const maxPrice  = query.maxPrice !== undefined && query.maxPrice !== '' ? Number(query.maxPrice) : undefined;
  const minRating = query.minRating !== undefined && query.minRating !== '' ? Number(query.minRating) : undefined;

  const whereConditions = [];

  if (category) whereConditions.push({ category });
  if (badge) whereConditions.push({ badge });
  if (sellerId) whereConditions.push({ sellerId });
  if (minPrice !== undefined && !Number.isNaN(minPrice)) {
    whereConditions.push({ price: { [Op.gte]: minPrice } });
  }
  if (maxPrice !== undefined && !Number.isNaN(maxPrice)) {
    whereConditions.push({ price: { [Op.lte]: maxPrice } });
  }
  if (minRating !== undefined && !Number.isNaN(minRating)) {
    whereConditions.push({ ratingAverage: { [Op.gte]: minRating } });
  }

  let order;
  if (query.sort && SORTS[query.sort]) {
    order = SORTS[query.sort];
  } else if (q) {
    order = [
      [Sequelize.literal(`ts_rank("Product".search_vector, websearch_to_tsquery('english', ${sequelize.escape(q)}))`), 'DESC'],
      ['created_at', 'DESC'],
    ];
  } else {
    order = SORTS.newest;
  }

  if (q) {
    whereConditions.push(
      Sequelize.literal(`"Product".search_vector @@ websearch_to_tsquery('english', ${sequelize.escape(q)})`)
    );
  }

  const where = whereConditions.length > 0 ? { [Op.and]: whereConditions } : {};
  return { where, order };
}

/**
 * Retrieves a paginated list of catalog products based on query filters, full-text search, and sorting.
 *
 * @param {object} query - Filter & pagination options from request query.
 * @returns {Promise<{ products: Array, pagination: object }>}
 */
async function getProducts(query = {}) {
  const page = Math.max(1, +query.page || 1);
  const itemsPerPage = query.limit ? Math.min(50, Math.max(1, +query.limit)) : ITEMS_PER_PAGE;
  const offset = (page - 1) * itemsPerPage;

  const { where, order } = buildProductFilter(query);

  const { count: totalItems, rows: products } = await Product.findAndCountAll({
    where,
    order,
    limit: itemsPerPage,
    offset,
    subQuery: false,
    include: [
      {
        model: User,
        as: 'seller',
        attributes: ['id', 'name', 'avatar', 'email'],
        include: [{ model: SellerProfile, as: 'sellerProfile' }],
      },
    ],
  });

  const lastPage = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  return {
    products,
    pagination: {
      currentPage: page,
      totalItems,
      lastPage,
      hasNextPage: itemsPerPage * page < totalItems,
      hasPreviousPage: page > 1,
      nextPage: page + 1,
      previousPage: page - 1,
    },
  };
}

/**
 * Retrieves a single product by its id, populated with artisan seller details.
 *
 * @param {string} productId - Product UUID string.
 * @returns {Promise<import('../db/models/Product')|null>}
 */
async function getProductById(productId) {
  if (!productId) return null;
  return Product.findByPk(productId, {
    include: [
      {
        model: User,
        as: 'seller',
        attributes: ['id', 'name', 'avatar', 'email'],
        include: [{ model: SellerProfile, as: 'sellerProfile' }],
      },
      {
        model: ProductVariant,
        as: 'variants',
      },
    ],
  });
}

/**
 * Serializes a product document for admin/seller management responses with artisan attribution.
 *
 * @param {import('../db/models/Product')} p
 * @param {object} [fallbackUser]
 * @returns {object}
 */
function serializeAdminProduct(p, fallbackUser) {
  const sellerObj = p.seller || p.userId;
  const isPopulated = sellerObj && typeof sellerObj === 'object' && (sellerObj._id || sellerObj.id);
  const userObj = isPopulated ? sellerObj : (fallbackUser && typeof fallbackUser === 'object' ? fallbackUser : null);
  const artisan = userObj
    ? {
        _id: userObj._id || userObj.id,
        name: userObj.name,
        email: userObj.email,
        shopName: userObj.sellerProfile?.shopName || userObj.name,
      }
    : null;

  return {
    _id: p.id || p._id,
    id: p.id || p._id,
    title: p.title,
    price: Number(p.price),
    compareAtPrice: p.compareAtPrice !== null && p.compareAtPrice !== undefined ? Number(p.compareAtPrice) : null,
    discount: {
      type: p.discountType || 'percentage',
      value: p.discountValue !== undefined ? Number(p.discountValue) : 0,
      isActive: Boolean(p.discountActive),
    },
    badge: p.badge || '',
    description: p.description,
    imageUrl: p.imageUrl,
    userId: isPopulated ? (userObj._id || userObj.id) : (p.sellerId || p.userId),
    sellerId: p.sellerId || p.userId,
    artisan,
    category: p.category,
    stock: p.stock !== undefined ? p.stock : 20,
    lowStockThreshold: p.lowStockThreshold !== undefined ? p.lowStockThreshold : 5,
    isAvailable: p.isAvailable !== undefined ? p.isAvailable : true,
    ratings: {
      average: Number(p.ratingAverage || 0),
      count: Number(p.ratingCount || 0),
    },
  };
}

/**
 * Creates and persists a new catalog piece for an artisan seller.
 *
 * @param {object} user
 * @param {object} productData
 * @param {string} imagePath
 * @returns {Promise<object>} Serialized admin product.
 */
async function createProduct(user, productData, imagePath) {
  const { title, price, description, stock, lowStockThreshold, category, badge } = productData;
  const product = await Product.create({
    title,
    price: Number(price),
    description: description || '',
    imageUrl: imagePath,
    sellerId: user.id || user._id,
    category: category || 'other',
    badge: badge || null,
    stock: stock !== undefined && stock !== '' ? Number(stock) : 20,
    lowStockThreshold: lowStockThreshold !== undefined && lowStockThreshold !== '' ? Number(lowStockThreshold) : 5,
  });
  return serializeAdminProduct(product, user);
}

/**
 * Retrieves a product for admin inspection with ownership verification.
 *
 * @param {string} productId
 * @param {object} user
 * @returns {Promise<object>} Serialized admin product.
 */
async function getAdminProductById(productId, user) {
  const product = await Product.findByPk(productId, {
    include: [
      {
        model: User,
        as: 'seller',
        include: [{ model: SellerProfile, as: 'sellerProfile' }],
      },
    ],
  });
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const isOwner = (product.sellerId || product.userId) === (user.id || user._id);
  if (!isOwner && user.role !== 'admin') {
    const error = new Error('Not authorized');
    error.status = 403;
    throw error;
  }

  return serializeAdminProduct(product, user);
}

/**
 * Updates product attributes, optionally replacing its image.
 *
 * @param {string} productId
 * @param {object} user
 * @param {object} updateData
 * @param {string} [newImagePath]
 * @returns {Promise<object>}
 */
async function updateProduct(productId, user, updateData, newImagePath) {
  const product = await Product.findByPk(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const isOwner = (product.sellerId || product.userId) === (user.id || user._id);
  if (!isOwner && user.role !== 'admin') {
    const error = new Error('Not authorized');
    error.status = 403;
    throw error;
  }

  const { title, price, description, stock, lowStockThreshold, isAvailable } = updateData;
  if (title !== undefined) product.title = title;
  if (price !== undefined) product.price = Number(price);
  if (description !== undefined) product.description = description;

  if (stock !== undefined && stock !== '') product.stock = Number(stock);
  if (lowStockThreshold !== undefined && lowStockThreshold !== '') {
    product.lowStockThreshold = Number(lowStockThreshold);
  }
  if (isAvailable !== undefined) {
    product.isAvailable = isAvailable === 'true' || isAvailable === true;
  }
  if (newImagePath) {
    fileHelper.deleteFile(product.imageUrl);
    product.imageUrl = newImagePath;
  }

  await product.save();
  return serializeAdminProduct(product, user);
}

/**
 * Deletes a product and its associated stored image.
 *
 * @param {string} productId
 * @param {object} user
 * @returns {Promise<void>}
 */
async function deleteProductById(productId, user) {
  const product = await Product.findByPk(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const isOwner = (product.sellerId || product.userId) === (user.id || user._id);
  if (!isOwner && user.role !== 'admin') {
    const error = new Error('Not authorized');
    error.status = 403;
    throw error;
  }

  fileHelper.deleteFile(product.imageUrl);
  await product.destroy();
}

/**
 * Applies a percentage or fixed discount to a product.
 *
 * @param {string} productId
 * @param {object} user
 * @param {{ type: string, value: number }} discountData
 * @returns {Promise<object>}
 */
async function applyProductDiscount(productId, user, { type, value }) {
  if (!type || !['percentage', 'fixed'].includes(type)) {
    const error = new Error('Invalid discount type. Must be percentage or fixed.');
    error.status = 422;
    throw error;
  }
  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) {
    const error = new Error('Discount value must be greater than zero.');
    error.status = 422;
    throw error;
  }

  const product = await Product.findByPk(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const isOwner = (product.sellerId || product.userId) === (user.id || user._id);
  if (!isOwner && user.role !== 'admin') {
    const error = new Error('Not authorized');
    error.status = 403;
    throw error;
  }

  const originalPrice = product.compareAtPrice != null ? Number(product.compareAtPrice) : Number(product.price);

  let discountedPrice;
  if (type === 'percentage') {
    if (numericValue >= 100) {
      const error = new Error('Percentage discount must be less than 100%.');
      error.status = 422;
      throw error;
    }
    discountedPrice = Math.round(originalPrice * (1 - numericValue / 100) * 100) / 100;
  } else {
    if (numericValue >= originalPrice) {
      const error = new Error('Fixed discount must be less than the product price.');
      error.status = 422;
      throw error;
    }
    discountedPrice = Math.round((originalPrice - numericValue) * 100) / 100;
  }

  product.compareAtPrice = originalPrice;
  product.price = discountedPrice;
  product.badge = 'sale';
  product.discountType = type;
  product.discountValue = numericValue;
  product.discountActive = true;

  await product.save();
  return serializeAdminProduct(product, user);
}

/**
 * Removes discount pricing from a product, restoring compareAtPrice.
 *
 * @param {string} productId
 * @param {object} user
 * @returns {Promise<object>}
 */
async function removeProductDiscount(productId, user) {
  const product = await Product.findByPk(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const isOwner = (product.sellerId || product.userId) === (user.id || user._id);
  if (!isOwner && user.role !== 'admin') {
    const error = new Error('Not authorized');
    error.status = 403;
    throw error;
  }

  if (product.compareAtPrice != null) {
    product.price = product.compareAtPrice;
    product.compareAtPrice = null;
  }
  if (product.badge === 'sale') {
    product.badge = null;
  }
  product.discountType = 'percentage';
  product.discountValue = 0;
  product.discountActive = false;

  await product.save();
  return serializeAdminProduct(product, user);
}

/**
 * Lists products filtered for seller management or cross-seller platform admin inspection.
 *
 * @param {object} user
 * @param {string} [sellerIdFilter]
 * @returns {Promise<Array<object>>}
 */
async function getAdminProducts(user, sellerIdFilter) {
  const isAdmin = user.role === 'admin';
  const where = {};
  if (!isAdmin) {
    where.sellerId = user.id || user._id;
  } else if (sellerIdFilter) {
    where.sellerId = sellerIdFilter;
  }

  const products = await Product.findAll({
    where,
    include: [
      {
        model: User,
        as: 'seller',
        include: [{ model: SellerProfile, as: 'sellerProfile' }],
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  return products.map((p) => serializeAdminProduct(p, user));
}

module.exports = {
  buildProductFilter,
  getProducts,
  getProductById,
  serializeAdminProduct,
  createProduct,
  getAdminProductById,
  updateProduct,
  deleteProductById,
  applyProductDiscount,
  removeProductDiscount,
  getAdminProducts,
};
