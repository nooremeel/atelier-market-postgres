/**
 * @file util/db.js
 * @description Database connection adapter for PostgreSQL edition.
 * Delegates to db/index.js (Sequelize instance).
 */

const { sequelize } = require('../db');

async function connectToDatabase() {
  await sequelize.authenticate();
  return sequelize;
}

module.exports = connectToDatabase;
