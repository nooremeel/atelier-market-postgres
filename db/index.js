const { Sequelize } = require('sequelize');
const pg = require('pg');
const config = require('./config');

// Gotcha fix: pg returns numeric (OID 1700) as string. Convert globally to float.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env] || config.development;

const sequelize = new Sequelize(dbConfig.url, {
  dialect: 'postgres',
  logging: dbConfig.logging,
  dialectOptions: dbConfig.dialectOptions || {},
  pool: dbConfig.pool || {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

let models;
function getModels() {
  if (!models) {
    const initModels = require('./models');
    models = initModels(sequelize);
  }
  return models;
}

module.exports = new Proxy(
  {
    sequelize,
    Sequelize,
    get models() {
      return getModels();
    },
  },
  {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      const initialized = getModels();
      return initialized[prop];
    },
  }
);
