'use strict';

const { Model, DataTypes } = require('sequelize');

class Address extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    return values;
  }
}

module.exports = (sequelize) => {
  Address.init(
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
        onDelete: 'CASCADE',
      },
      label: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'Home',
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      street: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      city: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      country: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      postalCode: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'postal_code',
      },
      phone: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_default',
      },
    },
    {
      sequelize,
      modelName: 'Address',
      tableName: 'addresses',
      underscored: true,
      timestamps: true,
    }
  );

  return Address;
};
