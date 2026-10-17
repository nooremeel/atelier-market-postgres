'use strict';

const { Model, DataTypes } = require('sequelize');

class ProductVariant extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    return values;
  }
}

module.exports = (sequelize) => {
  ProductVariant.init(
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
      productId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'product_id',
        references: {
          model: 'products',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      sku: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
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
      stock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
        validate: {
          min: 0,
        },
      },
    },
    {
      sequelize,
      modelName: 'ProductVariant',
      tableName: 'product_variants',
      underscored: true,
      timestamps: false,
    }
  );

  return ProductVariant;
};
