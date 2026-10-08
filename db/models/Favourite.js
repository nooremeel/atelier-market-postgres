'use strict';

const { Model, DataTypes } = require('sequelize');

class Favourite extends Model {}

module.exports = (sequelize) => {
  Favourite.init(
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
      productId: {
        type: DataTypes.UUID,
        primaryKey: true,
        field: 'product_id',
        references: {
          model: 'products',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
    },
    {
      sequelize,
      modelName: 'Favourite',
      tableName: 'favourites',
      underscored: true,
      timestamps: false,
    }
  );

  return Favourite;
};
