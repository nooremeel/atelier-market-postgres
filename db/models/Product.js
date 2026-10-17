'use strict';

const { Model, DataTypes } = require('sequelize');

class Product extends Model {
  static findById(id, options) {
    return this.findByPk(id, options);
  }

  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    values.userId = this.seller ? (this.seller.toJSON ? this.seller.toJSON() : this.seller) : this.sellerId;
    values.ratings = {
      average: this.ratingAverage !== undefined ? Number(this.ratingAverage) : 0,
      count: this.ratingCount !== undefined ? this.ratingCount : 0,
    };
    values.location = {
      city: this.city || '',
      country: this.country || '',
      lat: this.lat !== undefined ? this.lat : null,
      lng: this.lng !== undefined ? this.lng : null,
    };
    values.discount = {
      type: this.discountType || 'percentage',
      value: this.discountValue !== undefined ? Number(this.discountValue) : 0,
      isActive: Boolean(this.discountActive),
    };
    return values;
  }
}

module.exports = (sequelize) => {
  Product.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      _id: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.id;
        },
      },
      sellerId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'seller_id',
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'RESTRICT',
      },
      userId: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.sellerId;
        },
        set(val) {
          this.sellerId = val;
        },
      },
      title: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      imageUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'image_url',
      },
      price: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
          const raw = this.getDataValue('price');
          return raw === null || raw === undefined ? null : Number(raw);
        },
        validate: {
          min: 0,
        },
      },
      compareAtPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'compare_at_price',
        get() {
          const raw = this.getDataValue('compareAtPrice');
          return raw === null || raw === undefined ? null : Number(raw);
        },
      },
      discountType: {
        type: DataTypes.ENUM('percentage', 'fixed'),
        allowNull: false,
        defaultValue: 'percentage',
        field: 'discount_type',
      },
      discountValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'discount_value',
        get() {
          const raw = this.getDataValue('discountValue');
          return raw === null || raw === undefined ? 0 : Number(raw);
        },
      },
      discountActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'discount_active',
      },
      category: {
        type: DataTypes.ENUM('ceramics', 'leather', 'glass', 'books', 'textiles', 'metals', 'paper', 'other'),
        allowNull: false,
        defaultValue: 'other',
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      badge: {
        type: DataTypes.ENUM('new', 'bestseller', 'limited', 'sale'),
        allowNull: true,
        get() {
          const raw = this.getDataValue('badge');
          return raw === null ? '' : raw;
        },
        set(val) {
          this.setDataValue('badge', val === '' ? null : val);
        },
      },
      stock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 20,
        validate: {
          min: 0,
        },
      },
      lowStockThreshold: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
        field: 'low_stock_threshold',
        validate: {
          min: 1,
        },
      },
      isAvailable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_available',
      },
      ratingAverage: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'rating_average',
        get() {
          const raw = this.getDataValue('ratingAverage');
          return raw === null || raw === undefined ? 0 : Number(raw);
        },
        validate: {
          min: 0,
          max: 5,
        },
      },
      ratingCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'rating_count',
        validate: {
          min: 0,
        },
      },
      city: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      country: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      lat: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      lng: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      searchVector: {
        type: 'TSVECTOR',
        field: 'search_vector',
      },
      ratings: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            average: this.ratingAverage !== undefined ? Number(this.ratingAverage) : 0,
            count: this.ratingCount !== undefined ? this.ratingCount : 0,
          };
        },
        set(val) {
          if (val) {
            if (val.average !== undefined) this.ratingAverage = val.average;
            if (val.count !== undefined) this.ratingCount = val.count;
          }
        },
      },
      location: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            city: this.city || '',
            country: this.country || '',
            lat: this.lat !== undefined ? this.lat : null,
            lng: this.lng !== undefined ? this.lng : null,
          };
        },
        set(val) {
          if (val) {
            if (val.city !== undefined) this.city = val.city;
            if (val.country !== undefined) this.country = val.country;
            if (val.lat !== undefined) this.lat = val.lat;
            if (val.lng !== undefined) this.lng = val.lng;
          }
        },
      },
      discount: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            type: this.discountType || 'percentage',
            value: this.discountValue !== undefined ? Number(this.discountValue) : 0,
            isActive: Boolean(this.discountActive),
          };
        },
        set(val) {
          if (val) {
            if (val.type !== undefined) this.discountType = val.type;
            if (val.value !== undefined) this.discountValue = val.value;
            if (val.isActive !== undefined) this.discountActive = val.isActive;
          }
        },
      },
    },
    {
      sequelize,
      modelName: 'Product',
      tableName: 'products',
      underscored: true,
      timestamps: true,
    }
  );

  return Product;
};
