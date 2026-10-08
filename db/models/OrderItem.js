'use strict';

const { Model, DataTypes } = require('sequelize');

class OrderItem extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    values.productData = this.productSnapshot;
    values.variant = this.variantSnapshot;
    return values;
  }
}

module.exports = (sequelize) => {
  OrderItem.init(
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
      orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'order_id',
        references: {
          model: 'orders',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      productId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'product_id',
        references: {
          model: 'products',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      variantId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'variant_id',
        references: {
          model: 'product_variants',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      productSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        field: 'product_snapshot',
      },
      variantSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'variant_snapshot',
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
        },
      },
      productData: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.productSnapshot;
        },
        set(val) {
          this.productSnapshot = val;
        },
      },
      variant: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.variantSnapshot;
        },
        set(val) {
          this.variantSnapshot = val;
        },
      },
    },
    {
      sequelize,
      modelName: 'OrderItem',
      tableName: 'order_items',
      underscored: true,
      timestamps: false,
    }
  );

  return OrderItem;
};
