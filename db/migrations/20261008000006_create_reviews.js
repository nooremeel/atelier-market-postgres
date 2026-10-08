'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_name   text NOT NULL DEFAULT '',
        user_avatar text NOT NULL DEFAULT '',
        rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
        title       varchar(120)  NOT NULL,
        body        varchar(2000) NOT NULL,
        verified    boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (product_id, user_id)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS reviews;
    `);
  },
};
