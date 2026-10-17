'use strict';

const { Model, DataTypes } = require('sequelize');

class Discount extends Model {
  static findById(id, options) {
    return this.findByPk(id, options);
  }

  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    return values;
  }
}

module.exports = (sequelize) => {
  Discount.init(
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
      code: {
        type: 'CITEXT',
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
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
        field: 'discount_value',
        get() {
          const raw = this.getDataValue('discountValue');
          return raw === null || raw === undefined ? 0 : Number(raw);
        },
        validate: {
          min: 0,
        },
      },
      minOrderAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'min_order_amount',
        get() {
          const raw = this.getDataValue('minOrderAmount');
          return raw === null || raw === undefined ? 0 : Number(raw);
        },
      },
      maxDiscount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'max_discount',
        get() {
          const raw = this.getDataValue('maxDiscount');
          return raw === null || raw === undefined ? null : Number(raw);
        },
      },
      startDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'start_date',
      },
      endDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'end_date',
      },
      usageLimit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'usage_limit',
      },
      usedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'used_count',
        validate: {
          min: 0,
        },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
      sellerId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'seller_id',
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
    },
    {
      sequelize,
      modelName: 'Discount',
      tableName: 'discounts',
      underscored: true,
      timestamps: true,
    }
  );

  return Discount;
};
