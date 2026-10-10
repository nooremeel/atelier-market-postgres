'use strict';

const { Model, DataTypes } = require('sequelize');

class User extends Model {
  static findById(id, options) {
    return this.findByPk(id, options);
  }

  async populate(field) {
    if (field === 'favourites') {
      const { Favourite, Product } = require('./index');
      const favs = await Favourite.findAll({
        where: { userId: this.id },
        include: [{ model: Product, as: 'product' }],
      });
      this.favouriteProducts = favs.map((f) => f.product).filter(Boolean);
      return this;
    }
    return this;
  }

  async toggleFavourite(productId) {
    const { Favourite } = require('./index');
    const pId = productId._id || productId.id || productId;
    const existing = await Favourite.findOne({
      where: { userId: this.id, productId: pId },
    });
    if (existing) {
      await existing.destroy();
      return false;
    }
    try {
      await Favourite.create({ userId: this.id, productId: pId });
      return true;
    } catch (err) {
      return true;
    }
  }

  isFavourite(productId) {
    const pId = (productId._id || productId.id || productId).toString();
    if (this.favouriteProducts) {
      return this.favouriteProducts.some((p) => (p.id || p._id).toString() === pId);
    }
    return false;
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
    if (this.favouriteProducts) {
      values.favourites = this.favouriteProducts.map((p) => (p.id || p._id).toString());
    } else if (values.favourites === undefined) {
      values.favourites = [];
    }
    if (this.addresses && Array.isArray(this.addresses)) {
      values.addresses = this.addresses.map((a) => (a.toJSON ? a.toJSON() : a));
    } else if (values.addresses === undefined) {
      values.addresses = [];
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
      cart: {
        type: DataTypes.VIRTUAL,
        get() {
          return { items: [] };
        },
        set() {},
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
