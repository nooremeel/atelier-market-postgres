'use strict';

const { Model, DataTypes } = require('sequelize');

class User extends Model {
  static findById(id, options) {
    return this.findByPk(id, options);
  }

  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    if (this.addressStreet !== undefined) {
      values.address = {
        street: this.addressStreet || '',
        city: this.addressCity || '',
        country: this.addressCountry || '',
        postalCode: this.addressPostal || '',
      };
    }
    if (values.sellerProfile === undefined && this.sellerProfile !== undefined) {
      values.sellerProfile = this.sellerProfile ? (this.sellerProfile.toJSON ? this.sellerProfile.toJSON() : this.sellerProfile) : null;
    }
    if (values.favourites === undefined) {
      values.favourites = this.favouriteProducts ? this.favouriteProducts.map((p) => p.id || p._id) : [];
    }
    return values;
  }
}

module.exports = (sequelize) => {
  User.init(
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
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      email: {
        type: 'CITEXT',
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'password_hash',
      },
      role: {
        type: DataTypes.ENUM('customer', 'seller', 'admin'),
        allowNull: false,
        defaultValue: 'customer',
      },
      avatar: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      phone: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      addressStreet: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'address_street',
      },
      addressCity: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'address_city',
      },
      addressCountry: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'address_country',
      },
      addressPostal: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'address_postal',
      },
      defaultPaymentMethod: {
        type: DataTypes.ENUM('card', 'apple_pay', 'cash_on_delivery'),
        allowNull: false,
        defaultValue: 'card',
        field: 'default_payment',
      },
      savedCard: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'saved_card',
      },
      resetToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'reset_token',
      },
      resetTokenExpire: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'reset_token_expire',
      },
      address: {
        type: DataTypes.VIRTUAL,
        get() {
          return {
            street: this.addressStreet || '',
            city: this.addressCity || '',
            country: this.addressCountry || '',
            postalCode: this.addressPostal || '',
          };
        },
        set(val) {
          if (val) {
            if (val.street !== undefined) this.addressStreet = val.street;
            if (val.city !== undefined) this.addressCity = val.city;
            if (val.country !== undefined) this.addressCountry = val.country;
            if (val.postalCode !== undefined) this.addressPostal = val.postalCode;
          }
        },
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
    }
  );

  return User;
};
