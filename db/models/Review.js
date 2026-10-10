'use strict';

const { Model, DataTypes } = require('sequelize');

class Review extends Model {
  static findById(id, options) {
    return this.findByPk(id, options);
  }

  toJSON() {
    const values = { ...this.get() };
    values._id = values.id;
    if (this.user) {
      values.userId = this.user.toJSON ? this.user.toJSON() : this.user;
    }
    return values;
  }
}

module.exports = (sequelize) => {
  Review.init(
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
      userName: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'user_name',
      },
      userAvatar: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        field: 'user_avatar',
      },
      rating: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        validate: {
          min: 1,
          max: 5,
        },
      },
      title: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      body: {
        type: DataTypes.STRING(2000),
        allowNull: false,
      },
      verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'Review',
      tableName: 'reviews',
      underscored: true,
      timestamps: true,
    }
  );

  return Review;
};
