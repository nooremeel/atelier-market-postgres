'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name               text        NOT NULL DEFAULT '',
        email              citext      NOT NULL UNIQUE,
        password_hash      text        NOT NULL,
        role               user_role   NOT NULL DEFAULT 'customer',
        avatar             text        NOT NULL DEFAULT '',
        phone              text        NOT NULL DEFAULT '',
        address_street     text        NOT NULL DEFAULT '',
        address_city       text        NOT NULL DEFAULT '',
        address_country    text        NOT NULL DEFAULT '',
        address_postal     text        NOT NULL DEFAULT '',
        default_payment    payment_pref NOT NULL DEFAULT 'card',
        saved_card         jsonb,
        reset_token        text,
        reset_token_expire timestamptz,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS seller_profiles (
        user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        shop_name        text NOT NULL DEFAULT '',
        shop_description text NOT NULL DEFAULT '',
        shop_banner      text NOT NULL DEFAULT '',
        city             text NOT NULL DEFAULT '',
        country          text NOT NULL DEFAULT '',
        lat              double precision,
        lng              double precision,
        joined_at        timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS addresses (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label       text NOT NULL DEFAULT 'Home',
        name        text NOT NULL DEFAULT '',
        street      text NOT NULL,
        city        text NOT NULL,
        country     text NOT NULL,
        postal_code text NOT NULL DEFAULT '',
        phone       text NOT NULL DEFAULT '',
        is_default  boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
        ON addresses (user_id) WHERE is_default;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS addresses_one_default_per_user;
      DROP TABLE IF EXISTS addresses;
      DROP TABLE IF EXISTS seller_profiles;
      DROP TABLE IF EXISTS users;
    `);
  },
};
