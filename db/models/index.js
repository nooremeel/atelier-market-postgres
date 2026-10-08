'use strict';

function initModels(sequelize) {
  const User = require('./User')(sequelize);
  const SellerProfile = require('./SellerProfile')(sequelize);
  const Address = require('./Address')(sequelize);
  const Product = require('./Product')(sequelize);
  const ProductVariant = require('./ProductVariant')(sequelize);
  const CartItem = require('./CartItem')(sequelize);
  const Favourite = require('./Favourite')(sequelize);
  const Discount = require('./Discount')(sequelize);
  const Order = require('./Order')(sequelize);
  const OrderItem = require('./OrderItem')(sequelize);
  const OrderTimeline = require('./OrderTimeline')(sequelize);
  const Review = require('./Review')(sequelize);

  // User <-> SellerProfile (1:1)
  User.hasOne(SellerProfile, { foreignKey: 'userId', as: 'sellerProfile', onDelete: 'CASCADE' });
  SellerProfile.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });

  // User <-> Address (1:N)
  User.hasMany(Address, { foreignKey: 'userId', as: 'addresses', onDelete: 'CASCADE' });
  Address.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });

  // User <-> Product (1:N)
  User.hasMany(Product, { foreignKey: 'sellerId', as: 'products', onDelete: 'RESTRICT' });
  Product.belongsTo(User, { foreignKey: 'sellerId', as: 'seller', onDelete: 'RESTRICT' });

  // Product <-> ProductVariant (1:N)
  Product.hasMany(ProductVariant, { foreignKey: 'productId', as: 'variants', onDelete: 'CASCADE' });
  ProductVariant.belongsTo(Product, { foreignKey: 'productId', as: 'product', onDelete: 'CASCADE' });

  // User & Product <-> CartItem (1:N)
  User.hasMany(CartItem, { foreignKey: 'userId', as: 'cartItems', onDelete: 'CASCADE' });
  CartItem.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
  Product.hasMany(CartItem, { foreignKey: 'productId', as: 'cartItems', onDelete: 'CASCADE' });
  CartItem.belongsTo(Product, { foreignKey: 'productId', as: 'product', onDelete: 'CASCADE' });
  ProductVariant.hasMany(CartItem, { foreignKey: 'variantId', as: 'cartItems', onDelete: 'CASCADE' });
  CartItem.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant', onDelete: 'CASCADE' });

  // User <-> Favourite <-> Product (M:N)
  User.belongsToMany(Product, { through: Favourite, foreignKey: 'userId', otherKey: 'productId', as: 'favouriteProducts' });
  Product.belongsToMany(User, { through: Favourite, foreignKey: 'productId', otherKey: 'userId', as: 'favouritedBy' });
  User.hasMany(Favourite, { foreignKey: 'userId', as: 'favourites', onDelete: 'CASCADE' });
  Favourite.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
  Product.hasMany(Favourite, { foreignKey: 'productId', as: 'favourites', onDelete: 'CASCADE' });
  Favourite.belongsTo(Product, { foreignKey: 'productId', as: 'product', onDelete: 'CASCADE' });

  // User <-> Discount (1:N, optional sellerId)
  User.hasMany(Discount, { foreignKey: 'sellerId', as: 'discounts', onDelete: 'SET NULL' });
  Discount.belongsTo(User, { foreignKey: 'sellerId', as: 'seller', onDelete: 'SET NULL' });

  // User <-> Order (1:N)
  User.hasMany(Order, { foreignKey: 'userId', as: 'orders', onDelete: 'RESTRICT' });
  Order.belongsTo(User, { foreignKey: 'userId', as: 'customer', onDelete: 'RESTRICT' });

  // Order <-> OrderItem (1:N)
  Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
  OrderItem.belongsTo(Order, { foreignKey: 'orderId', as: 'order', onDelete: 'CASCADE' });
  Product.hasMany(OrderItem, { foreignKey: 'productId', as: 'orderItems', onDelete: 'SET NULL' });
  OrderItem.belongsTo(Product, { foreignKey: 'productId', as: 'product', onDelete: 'SET NULL' });
  ProductVariant.hasMany(OrderItem, { foreignKey: 'variantId', as: 'orderItems', onDelete: 'SET NULL' });
  OrderItem.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'productVariant', onDelete: 'SET NULL' });

  // Order <-> OrderTimeline (1:N)
  Order.hasMany(OrderTimeline, { foreignKey: 'orderId', as: 'timeline', onDelete: 'CASCADE' });
  OrderTimeline.belongsTo(Order, { foreignKey: 'orderId', as: 'order', onDelete: 'CASCADE' });

  // Product & User <-> Review (1:N)
  Product.hasMany(Review, { foreignKey: 'productId', as: 'reviews', onDelete: 'CASCADE' });
  Review.belongsTo(Product, { foreignKey: 'productId', as: 'product', onDelete: 'CASCADE' });
  User.hasMany(Review, { foreignKey: 'userId', as: 'reviews', onDelete: 'CASCADE' });
  Review.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });

  return {
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
    sequelize,
  };
}

let cachedModels = null;
function getExport() {
  if (!cachedModels) {
    const { sequelize } = require('../index');
    cachedModels = initModels(sequelize);
  }
  return cachedModels;
}

module.exports = new Proxy(initModels, {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    const models = getExport();
    return models[prop];
  },
});
