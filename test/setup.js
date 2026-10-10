const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { sequelize } = require('../db');

// beforeAll / afterAll / afterEach are provided as globals (vitest.config.mjs -> test.globals: true).
// vitest's ESM-only entry cannot be require()'d from a CommonJS setup file.

let mongod;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';

  // 1. Authenticate PostgreSQL test database
  await sequelize.authenticate();

  // 2. Legacy Mongo in-memory server (for remaining unported test suites)
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  // Reset PostgreSQL tables
  try {
    await sequelize.query(
      'TRUNCATE TABLE users, seller_profiles, addresses, products, product_variants, cart_items, favourites, discounts, orders, order_items, order_timeline, reviews, "session" RESTART IDENTITY CASCADE;'
    );
  } catch (err) {
    // If some table does not exist or truncate fails, log or pass
    console.error('[Test Setup Truncate Error]:', err.message);
  }

  // Reset MongoDB collections
  if (mongoose.connection && mongoose.connection.readyState >= 1) {
    const { collections } = mongoose.connection;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
  await sequelize.close();
});
