/**
 * @file services/authService.js
 * @description Business logic for authentication: user lookup, demo account bootstrapping,
 *              password verification, user creation, and password reset lifecycle.
 *              All DB queries and bcrypt operations live here; the controller
 *              is responsible only for session management and HTTP responses.
 *              Uses PostgreSQL / Sequelize models.
 */

const crypto = require('crypto');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, SellerProfile } = require('../db/models');

const randomBytesAsync = promisify(crypto.randomBytes);

// ---------------------------------------------------------------------------
// Login helpers
// ---------------------------------------------------------------------------

/**
 * Look up a user by email.
 * @param {string} email
 * @returns {Promise<import('../db/models/User')|null>}
 */
async function findUserByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return User.findOne({
    where: { email: email.toLowerCase().trim() },
    include: [{ model: SellerProfile, as: 'sellerProfile' }],
  });
}

/**
 * Provisions a missing demo account when DEMO_MODE is enabled and the
 * incoming password matches the shared demo credential.
 * Only creates accounts for the three known demo email addresses.
 *
 * @param {string} email
 * @param {string} password - The raw password supplied by the login request.
 * @returns {Promise<import('../db/models/User')|null>} The newly
 *   created user document, or null if conditions are not met.
 */
async function bootstrapDemoUser(email, password) {
  if (process.env.DEMO_MODE !== 'true' || password !== 'Demo1234!') return null;

  const normalizedEmail = (email || '').toLowerCase().trim();
  const hash = await bcrypt.hash('Demo1234!', 10);

  const demoProfiles = {
    'admin@ateliermarket.com': {
      name: 'Admin Director',
      email: 'admin@ateliermarket.com',
      role: 'admin',
      password: hash,
    },
    'layla@ateliermarket.com': {
      name: 'Layla Al-Rashidi',
      email: 'layla@ateliermarket.com',
      role: 'seller',
      password: hash,
      sellerProfile: {
        shopName: 'Al-Rashidi Ceramics',
        shopDescription:
          'Third-generation ceramicist from the Gulf. Wheel-thrown stoneware and mineral glazes.',
        city: 'Manama',
        country: 'Bahrain',
        lat: 26.2235,
        lng: 50.5876,
      },
    },
    'sara@example.com': {
      name: 'Sara Hassan',
      email: 'sara@example.com',
      role: 'customer',
      password: hash,
    },
  };

  const profile = demoProfiles[normalizedEmail];
  if (!profile) return null;

  if (profile.sellerProfile) {
    return User.create(profile, {
      include: [{ model: SellerProfile, as: 'sellerProfile' }],
    });
  }

  const user = await User.create(profile);
  user.sellerProfile = null;
  return user;
}

/**
 * Verifies the supplied password against the stored hash.
 * In DEMO_MODE, if the admin password has drifted (e.g. after a DB restore),
 * it is silently re-synced to the demo credential.
 *
 * @param {import('../db/models/User')} user
 * @param {string} password - Raw password from the login request.
 * @returns {Promise<boolean>} True if authentication should be granted.
 */
async function verifyPassword(user, password) {
  const match = await bcrypt.compare(password, user.password);
  if (match) return true;

  // Demo-mode admin password drift recovery
  if (
    process.env.DEMO_MODE === 'true' &&
    user.email === 'admin@ateliermarket.com' &&
    password === 'Demo1234!'
  ) {
    user.password = await bcrypt.hash('Demo1234!', 10);
    user.role = 'admin';
    await user.save();
    return true;
  }

  return false;
}

/**
 * Looks up a user by email, and if missing in DEMO_MODE, auto-provisions
 * the matching demo persona.
 *
 * @param {string} email
 * @param {string} password - Raw password from login request.
 * @returns {Promise<import('../db/models/User')|null>}
 */
async function findOrBootstrapDemoUser(email, password) {
  let user = await findUserByEmail(email);
  if (!user) {
    user = await bootstrapDemoUser(email, password);
  }
  return user;
}

/**
 * Authenticates a user with email and password. Handles demo account
 * auto-bootstrapping and password comparison.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('../db/models/User')|null>} Returns the user on success, null on failure.
 */
async function authenticateUser(email, password) {
  const user = await findOrBootstrapDemoUser(email, password);
  if (!user) return null;

  const authenticated = await verifyPassword(user, password);
  if (!authenticated) return null;

  return user;
}

// ---------------------------------------------------------------------------
// Signup helper
// ---------------------------------------------------------------------------

/**
 * Creates and persists a new user account.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password - Raw password; hashed here before storage.
 * @param {string} [params.name]
 * @param {'customer'|'seller'} [params.role]
 * @returns {Promise<import('../db/models/User')>}
 */
async function createUser({ email, password, name, role }) {
  const assignedRole = role === 'seller' ? 'seller' : 'customer';
  const displayName =
    (name || '').trim() ||
    email
      .split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const hashed = await bcrypt.hash(password, 12);

  const userData = {
    name: displayName,
    email: email.toLowerCase().trim(),
    password: hashed,
    role: assignedRole,
  };

  if (assignedRole === 'seller') {
    userData.sellerProfile = {
      shopName: '',
      shopDescription: '',
      shopBanner: '',
      city: '',
      country: '',
      lat: null,
      lng: null,
      joinedAt: new Date(),
    };
    return User.create(userData, {
      include: [{ model: SellerProfile, as: 'sellerProfile' }],
    });
  }

  const user = await User.create(userData);
  user.sellerProfile = null;
  return user;
}

// ---------------------------------------------------------------------------
// Password reset helpers
// ---------------------------------------------------------------------------

/**
 * Generates a secure reset token and writes it to the user document.
 * If no user with the given email exists, this is a no-op — the controller
 * always responds with { ok: true } to prevent email enumeration.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
async function initiatePasswordReset(email) {
  if (!email || typeof email !== 'string') return;
  const buffer = await randomBytesAsync(32);
  const token = buffer.toString('hex');

  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (user) {
    user.resetToken = token;
    user.resetTokenExpire = new Date(Date.now() + 3_600_000); // 1 hour
    await user.save();
  }
}

/**
 * Validates a password-reset token and returns the matching user's safe data.
 *
 * @param {string} token
 * @returns {Promise<{ email: string, userId: string }|null>}
 */
async function validateResetToken(token) {
  if (!token || typeof token !== 'string') return null;
  const user = await User.findOne({
    where: {
      resetToken: token,
      resetTokenExpire: { [Op.gt]: new Date() },
    },
  });
  if (!user) return null;
  return { email: user.email, userId: user.id || user._id };
}

/**
 * Applies a new hashed password to the user identified by both userId and
 * the valid reset token, then clears the token fields.
 *
 * @param {string} userId
 * @param {string} passwordToken
 * @param {string} newPassword - Raw new password; hashed here before storage.
 * @returns {Promise<boolean>} False if the token is invalid or expired.
 */
async function changePassword(userId, passwordToken, newPassword) {
  if (!userId || !passwordToken || !newPassword) return false;
  const user = await User.findOne({
    where: {
      id: userId,
      resetToken: passwordToken,
      resetTokenExpire: { [Op.gt]: new Date() },
    },
  });
  if (!user) return false;

  user.password = await bcrypt.hash(newPassword, 12);
  user.resetToken = null;
  user.resetTokenExpire = null;
  await user.save();
  return true;
}

module.exports = {
  findUserByEmail,
  bootstrapDemoUser,
  findOrBootstrapDemoUser,
  verifyPassword,
  authenticateUser,
  createUser,
  initiatePasswordReset,
  validateResetToken,
  changePassword,
};
