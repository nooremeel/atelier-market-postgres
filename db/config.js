require('dotenv').config();

const logging = process.env.DB_LOGGING === 'true' ? console.log : false;

module.exports = {
  development: {
    url: process.env.DATABASE_URL || 'postgres://atelier:atelier@localhost:5432/atelier',
    dialect: 'postgres',
    logging,
  },
  test: {
    url: process.env.DATABASE_URL_TEST || 'postgres://test:test@localhost:5433/atelier_test',
    dialect: 'postgres',
    logging: false,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
};
