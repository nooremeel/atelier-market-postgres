/**
 * @file test/setup.js
 * @description Global Vitest setup for PostgreSQL edition of Atelier Market.
 * Connects to the test database and truncates all relational tables between tests.
 */

const { sequelize } = require('../db');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await sequelize.authenticate();
});

afterEach(async () => {
  try {
    await sequelize.query(
      'TRUNCATE TABLE users, seller_profiles, addresses, products, product_variants, cart_items, favourites, discounts, orders, order_items, order_timeline, reviews, "session" RESTART IDENTITY CASCADE;'
    );
  } catch (err) {
    console.error('[Test Setup Truncate Error]:', err.message);
  }
});

afterAll(async () => {
  await sequelize.close();
});
