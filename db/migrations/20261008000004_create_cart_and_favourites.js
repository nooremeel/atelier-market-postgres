'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
        quantity   integer NOT NULL CHECK (quantity > 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS cart_items_unique_line
        ON cart_items (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

      CREATE TABLE IF NOT EXISTS favourites (
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, product_id)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS favourites;
      DROP TABLE IF EXISTS cart_items;
    `);
  },
};
