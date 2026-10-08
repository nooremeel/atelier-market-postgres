'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, $2) $$;

      CREATE TABLE IF NOT EXISTS products (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        seller_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        title               text NOT NULL,
        description         text NOT NULL,
        image_url           text NOT NULL,
        price               numeric(12,2) NOT NULL CHECK (price >= 0),
        compare_at_price    numeric(12,2) CHECK (compare_at_price >= 0),
        discount_type       discount_kind NOT NULL DEFAULT 'percentage',
        discount_value      numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
        discount_active     boolean NOT NULL DEFAULT false,
        category            product_category NOT NULL DEFAULT 'other',
        tags                text[] NOT NULL DEFAULT '{}',
        badge               product_badge,
        stock               integer NOT NULL DEFAULT 20 CHECK (stock >= 0),
        low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 1),
        is_available        boolean NOT NULL DEFAULT true,
        rating_average      numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_average BETWEEN 0 AND 5),
        rating_count        integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
        city                text NOT NULL DEFAULT '',
        country             text NOT NULL DEFAULT '',
        lat                 double precision,
        lng                 double precision,
        search_vector       tsvector GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(immutable_array_to_string(tags, ' '), '')), 'B') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'C')
        ) STORED,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS products_search_idx   ON products USING GIN (search_vector);
      CREATE INDEX IF NOT EXISTS products_tags_idx     ON products USING GIN (tags);
      CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
      CREATE INDEX IF NOT EXISTS products_price_idx    ON products (price);
      CREATE INDEX IF NOT EXISTS products_seller_idx   ON products (seller_id);

      CREATE TABLE IF NOT EXISTS product_variants (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name             text NOT NULL,
        sku              text NOT NULL DEFAULT '',
        price            numeric(12,2) NOT NULL CHECK (price >= 0),
        compare_at_price numeric(12,2) CHECK (compare_at_price >= 0),
        stock            integer NOT NULL DEFAULT 10 CHECK (stock >= 0)
      );

      CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS product_variants;
      DROP TABLE IF EXISTS products;
      DROP FUNCTION IF EXISTS immutable_array_to_string(text[], text);
    `);
  },
};
