/**
 * @file server.js
 * @description Local development and standalone server entry point for PostgreSQL edition.
 * Connects to PostgreSQL via Sequelize, conditionally seeds demo data,
 * mounts app.js, and begins listening.
 */

require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./db');
const seed = require('./scripts/seed');

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  console.log('[DB] Connecting to PostgreSQL...');
  await sequelize.authenticate();
  console.log('[DB] PostgreSQL connected successfully.');

  if (process.env.DEMO_MODE === 'true') {
    console.log('[Demo] DEMO_MODE enabled — bootstrapping seed data...');
    await seed();
  } else {
    console.log('[Server] DEMO_MODE is not enabled — skipping demo seeds.');
  }

  const server = app.listen(PORT, () => {
    console.log(`\n========================================================`);
    console.log(` ✨  ATELIER MARKET  —  PostgreSQL Edition`);
    console.log(`========================================================`);
    console.log(` 🌐  http://localhost:${PORT}`);
    if (process.env.DEMO_MODE === 'true') {
      console.log(`\n 👤  Artisan Seller (password: Demo1234!):`);
      console.log(`     layla@ateliermarket.com  — Al-Rashidi Ceramics (Bahrain)`);
      console.log(`     omar@ateliermarket.com   — Khalil Bindery (Cairo)`);
      console.log(`     nour@ateliermarket.com   — Beit Al-Nour Glass (Beirut)`);
      console.log(`     tariq@ateliermarket.com  — Atelier Saud Metals (Riyadh)`);
      console.log(`\n 🛍️  Customer Accounts (password: Demo1234!):`);
      console.log(`     sara@example.com  · james@example.com  · aisha@example.com`);
      console.log(`\n 👑  Platform Admin (password: Demo1234!):`);
      console.log(`     admin@ateliermarket.com  — Admin Director`);
    }
    console.log(`========================================================\n`);
  });

  const shutdown = async () => {
    console.log('\nGracefully shutting down...');
    server.close();
    await sequelize.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Error] Server startup failed:', err);
  process.exit(1);
});
