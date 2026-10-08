'use strict';

const { Model, DataTypes } = require('sequelize');

class SellerProfile extends Model {
  toJSON() {
    const values = { ...this.get() };
    values._id = values.userId;
    values.location = {
      city: this.city || '',
      country: this.country || '',
      lat: this.lat !== undefined ? this.lat : null,
      lng: this.lng !== undefined ? this.lng : null,
    };
    return values;
  }
}

module.exports = (sequelize) => {
  SellerProfile.init(
    {
      userId: {
        type: DataTypes.UUID,
        primaryKey: true,
        field: 'user_id',
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      _id: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.userId;
        },
      },
      shopName: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'shop_name',
      },
      shopDescription: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'shop_description',
      },
      shopBanner: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'shop_banner',
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
      joinedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'joined_at',
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
    },
    {
      sequelize,
      modelName: 'SellerProfile',
      tableName: 'seller_profiles',
      underscored: true,
      timestamps: false,
    }
  );

  return SellerProfile;
};
