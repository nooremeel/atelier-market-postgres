'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE EXTENSION IF NOT EXISTS citext;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('customer', 'seller', 'admin');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE payment_pref AS ENUM ('card', 'apple_pay', 'cash_on_delivery');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE discount_kind AS ENUM ('percentage', 'fixed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE product_category AS ENUM ('ceramics', 'leather', 'glass', 'books', 'textiles', 'metals', 'paper', 'other');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE product_badge AS ENUM ('new', 'bestseller', 'limited', 'sale');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'crafting', 'shipped', 'delivered', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('unpaid', 'paid', 'refunded');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS payment_status;
      DROP TYPE IF EXISTS order_status;
      DROP TYPE IF EXISTS product_badge;
      DROP TYPE IF EXISTS product_category;
      DROP TYPE IF EXISTS discount_kind;
      DROP TYPE IF EXISTS payment_pref;
      DROP TYPE IF EXISTS user_role;
      DROP EXTENSION IF EXISTS pg_trgm;
      DROP EXTENSION IF EXISTS citext;
    `);
  },
};
