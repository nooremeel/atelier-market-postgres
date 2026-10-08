'use strict';

const { Model, DataTypes } = require('sequelize');

class OrderTimeline extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    values.timestamp = this.createdAt;
    return values;
  }
}

module.exports = (sequelize) => {
  OrderTimeline.init(
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
      status: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      timestamp: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.createdAt;
        },
      },
    },
    {
      sequelize,
      modelName: 'OrderTimeline',
      tableName: 'order_timeline',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return OrderTimeline;
};
