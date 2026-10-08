'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS discounts (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code             citext NOT NULL UNIQUE,
        description      text NOT NULL DEFAULT '',
        discount_type    discount_kind NOT NULL DEFAULT 'percentage',
        discount_value   numeric(12,2) NOT NULL CHECK (discount_value >= 0),
        min_order_amount numeric(12,2) NOT NULL DEFAULT 0,
        max_discount     numeric(12,2),
        start_date       timestamptz,
        end_date         timestamptz,
        usage_limit      integer,
        used_count       integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
        is_active        boolean NOT NULL DEFAULT true,
        seller_id        uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CHECK (usage_limit IS NULL OR used_count <= usage_limit)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        user_email              citext NOT NULL,
        user_name               text NOT NULL DEFAULT '',
        subtotal                numeric(12,2) NOT NULL DEFAULT 0,
        shipping_fee            numeric(12,2) NOT NULL DEFAULT 0,
        discount_code           text NOT NULL DEFAULT '',
        discount_type           text NOT NULL DEFAULT '',
        discount_value          numeric(12,2) NOT NULL DEFAULT 0,
        discount_amount         numeric(12,2) NOT NULL DEFAULT 0,
        total_price             numeric(12,2) NOT NULL CHECK (total_price >= 0),
        status                  order_status   NOT NULL DEFAULT 'pending',
        payment_status          payment_status NOT NULL DEFAULT 'unpaid',
        payment_method          text NOT NULL DEFAULT 'card',
        payment_reference       text NOT NULL DEFAULT '',
        ship_name               text NOT NULL DEFAULT '',
        ship_street             text NOT NULL DEFAULT '',
        ship_city               text NOT NULL DEFAULT '',
        ship_country            text NOT NULL DEFAULT '',
        ship_postal_code        text NOT NULL DEFAULT '',
        carrier                 text NOT NULL DEFAULT 'Aramex White-Glove Express',
        tracking_number         text NOT NULL DEFAULT '',
        estimated_delivery_date timestamptz,
        notes                   text NOT NULL DEFAULT '',
        created_at              timestamptz NOT NULL DEFAULT now(),
        updated_at              timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_payment_ref_idx  ON orders (payment_reference) WHERE payment_reference <> '';

      CREATE TABLE IF NOT EXISTS order_items (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id       uuid REFERENCES products(id) ON DELETE SET NULL,
        variant_id       uuid REFERENCES product_variants(id) ON DELETE SET NULL,
        product_snapshot jsonb NOT NULL,
        variant_snapshot jsonb,
        quantity         integer NOT NULL CHECK (quantity > 0)
      );

      CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

      CREATE TABLE IF NOT EXISTS order_timeline (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        status     text NOT NULL,
        note       text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS order_timeline_order_idx ON order_timeline (order_id, created_at);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS order_timeline;
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS discounts;
    `);
  },
};
