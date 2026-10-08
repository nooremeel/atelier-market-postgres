'use strict';

const { Model, DataTypes } = require('sequelize');

class Order extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    values.user = {
      userId: this.userId,
      email: this.userEmail,
      name: this.userName || '',
    };
    values.shippingAddress = {
      name: this.shipName || '',
      street: this.shipStreet || '',
      city: this.shipCity || '',
      country: this.shipCountry || '',
      postalCode: this.shipPostalCode || '',
    };
    values.discount = {
      code: this.discountCode || '',
      discountType: this.discountType || '',
      discountValue: this.discountValue !== undefined ? Number(this.discountValue) : 0,
      amount: this.discountAmount !== undefined ? Number(this.discountAmount) : 0,
    };
    return values;
  }
}

module.exports = (sequelize) => {
  Order.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'RESTRICT',
      },
      userEmail: {
        type: 'CITEXT',
        allowNull: false,
        field: 'user_email',
      },
      userName: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'user_name',
      },
      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      shippingFee: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'shipping_fee',
      },
      discountCode: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'discount_code',
      },
      discountType: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'discount_type',
      },
      discountValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'discount_value',
      },
      discountAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'discount_amount',
      },
      totalPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'total_price',
        validate: {
          min: 0,
        },
      },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'crafting', 'shipped', 'delivered', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      paymentStatus: {
        type: DataTypes.ENUM('unpaid', 'paid', 'refunded'),
        allowNull: false,
        defaultValue: 'unpaid',
        field: 'payment_status',
      },
      paymentMethod: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'card',
        field: 'payment_method',
      },
      paymentReference: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'payment_reference',
      },
      shipName: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'ship_name',
      },
      shipStreet: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'ship_street',
      },
      shipCity: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'ship_city',
      },
      shipCountry: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'ship_country',
      },
      shipPostalCode: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'ship_postal_code',
      },
      carrier: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Aramex White-Glove Express',
      },
      trackingNumber: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'tracking_number',
      },
      estimatedDeliveryDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'estimated_delivery_date',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      user: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            userId: this.userId,
            email: this.userEmail,
            name: this.userName || '',
          };
        },
      },
      shippingAddress: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            name: this.shipName || '',
            street: this.shipStreet || '',
            city: this.shipCity || '',
            country: this.shipCountry || '',
            postalCode: this.shipPostalCode || '',
          };
        },
      },
      discount: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            code: this.discountCode || '',
            discountType: this.discountType || '',
            discountValue: this.discountValue !== undefined ? Number(this.discountValue) : 0,
            amount: this.discountAmount !== undefined ? Number(this.discountAmount) : 0,
          };
        },
      },
    },
    {
      sequelize,
      modelName: 'Order',
      tableName: 'orders',
      underscored: true,
      timestamps: true,
    }
  );

  return Order;
};
