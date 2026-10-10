const authService = require('../../services/authService');
const { User } = require('../../db/models');
const bcrypt = require('bcryptjs');

describe('authService', () => {
  const originalDemoMode = process.env.DEMO_MODE;

  afterEach(() => {
    process.env.DEMO_MODE = originalDemoMode;
  });

  describe('findUserByEmail', () => {
    it('returns null when user does not exist', async () => {
      const user = await authService.findUserByEmail('unknown@domain.com');
      expect(user).toBeNull();
    });

    it('returns the user document when exists', async () => {
      await authService.createUser({ email: 'test@domain.com', password: 'Password123!', name: 'Test User' });
      const found = await authService.findUserByEmail('test@domain.com');
      expect(found).not.toBeNull();
      expect(found.email).toBe('test@domain.com');
    });
  });

  describe('bootstrapDemoUser', () => {
    it('returns null if DEMO_MODE is not true', async () => {
      process.env.DEMO_MODE = 'false';
      const user = await authService.bootstrapDemoUser('admin@ateliermarket.com', 'Demo1234!');
      expect(user).toBeNull();
    });

    it('returns null if password does not match demo password', async () => {
      process.env.DEMO_MODE = 'true';
      const user = await authService.bootstrapDemoUser('admin@ateliermarket.com', 'WrongPass!');
      expect(user).toBeNull();
    });

    it('returns null if email is not a known demo persona', async () => {
      process.env.DEMO_MODE = 'true';
      const user = await authService.bootstrapDemoUser('random@domain.com', 'Demo1234!');
      expect(user).toBeNull();
    });

    it('provisions demo admin user when DEMO_MODE is enabled', async () => {
      process.env.DEMO_MODE = 'true';
      const user = await authService.bootstrapDemoUser('admin@ateliermarket.com', 'Demo1234!');
      expect(user).not.toBeNull();
      expect(user.email).toBe('admin@ateliermarket.com');
      expect(user.role).toBe('admin');
    });
  });

  describe('verifyPassword', () => {
    it('returns true when password matches hash', async () => {
      const user = await authService.createUser({ email: 'verified@domain.com', password: 'Secret123!' });
      const result = await authService.verifyPassword(user, 'Secret123!');
      expect(result).toBe(true);
    });

    it('returns false when password does not match hash', async () => {
      const user = await authService.createUser({ email: 'verified2@domain.com', password: 'Secret123!' });
      const result = await authService.verifyPassword(user, 'WrongSecret!');
      expect(result).toBe(false);
    });

    it('recovers drifted admin password in DEMO_MODE', async () => {
      process.env.DEMO_MODE = 'true';
      const wrongHash = await bcrypt.hash('OldAdminPass!', 10);
      const admin = await User.create({
        email: 'admin@ateliermarket.com',
        name: 'Admin',
        password: wrongHash,
        role: 'customer',
      });

      const result = await authService.verifyPassword(admin, 'Demo1234!');
      expect(result).toBe(true);

      const refreshed = await User.findById(admin._id);
      expect(refreshed.role).toBe('admin');
      const isCorrectNow = await bcrypt.compare('Demo1234!', refreshed.password);
      expect(isCorrectNow).toBe(true);
    });
  });

  describe('authenticateUser', () => {
    it('authenticates existing user with valid password', async () => {
      await authService.createUser({ email: 'authuser@domain.com', password: 'ValidPass123!' });
      const user = await authService.authenticateUser('authuser@domain.com', 'ValidPass123!');
      expect(user).not.toBeNull();
      expect(user.email).toBe('authuser@domain.com');
    });

    it('returns null for wrong password', async () => {
      await authService.createUser({ email: 'authuser2@domain.com', password: 'ValidPass123!' });
      const user = await authService.authenticateUser('authuser2@domain.com', 'WrongPass!');
      expect(user).toBeNull();
    });

    it('returns null for non-existent user when not in demo mode', async () => {
      process.env.DEMO_MODE = 'false';
      const user = await authService.authenticateUser('nonexistent@domain.com', 'ValidPass123!');
      expect(user).toBeNull();
    });

    it('auto-provisions and authenticates demo user when in DEMO_MODE', async () => {
      process.env.DEMO_MODE = 'true';
      const user = await authService.authenticateUser('sara@example.com', 'Demo1234!');
      expect(user).not.toBeNull();
      expect(user.email).toBe('sara@example.com');
      expect(user.name).toBe('Sara Hassan');
    });
  });

  describe('createUser', () => {
    it('creates a customer by default', async () => {
      const user = await authService.createUser({ email: 'customer@domain.com', password: 'Pass123!', name: 'Customer One' });
      expect(user.role).toBe('customer');
      expect(user.sellerProfile).toBeNull();
      expect(user.name).toBe('Customer One');
    });

    it('creates a seller with initialized sellerProfile', async () => {
      const user = await authService.createUser({ email: 'artisan@domain.com', password: 'Pass123!', role: 'seller' });
      expect(user.role).toBe('seller');
      expect(user.sellerProfile).toBeDefined();
      expect(user.sellerProfile.location).toBeDefined();
    });
  });

  describe('password reset lifecycle', () => {
    it('generates a reset token on initiatePasswordReset', async () => {
      const user = await authService.createUser({ email: 'resetme@domain.com', password: 'Pass123!' });
      await authService.initiatePasswordReset('resetme@domain.com');

      const updated = await User.findById(user._id);
      expect(updated.resetToken).toBeDefined();
      expect(new Date(updated.resetTokenExpire).getTime()).toBeGreaterThan(Date.now());
    });

    it('safely handles initiatePasswordReset for non-existent user without throwing', async () => {
      await expect(authService.initiatePasswordReset('ghost@domain.com')).resolves.toBeUndefined();
    });

    it('validates active reset token and returns safe user data', async () => {
      const user = await authService.createUser({ email: 'tokencheck@domain.com', password: 'Pass123!' });
      await authService.initiatePasswordReset('tokencheck@domain.com');

      const updated = await User.findById(user._id);
      const token = updated.resetToken;

      const validated = await authService.validateResetToken(token);
      expect(validated).not.toBeNull();
      expect(validated.email).toBe('tokencheck@domain.com');
      expect(validated.userId).toBe(user._id.toString());
    });

    it('returns null for expired or invalid reset token', async () => {
      const user = await authService.createUser({ email: 'expired@domain.com', password: 'Pass123!' });
      user.resetToken = 'expiredtoken123';
      user.resetTokenExpire = new Date(Date.now() - 1000);
      await user.save();

      const validated = await authService.validateResetToken('expiredtoken123');
      expect(validated).toBeNull();

      const invalid = await authService.validateResetToken('nonexistenttoken');
      expect(invalid).toBeNull();
    });

    it('changes password with valid token and clears reset fields', async () => {
      const user = await authService.createUser({ email: 'changeme@domain.com', password: 'OldPassword1!' });
      await authService.initiatePasswordReset('changeme@domain.com');

      const updated = await User.findById(user._id);
      const token = updated.resetToken;

      const success = await authService.changePassword(user._id.toString(), token, 'NewBrandPassword123!');
      expect(success).toBe(true);

      const reloaded = await User.findById(user._id);
      expect(reloaded.resetToken).toBeNull();
      const checkNewPass = await bcrypt.compare('NewBrandPassword123!', reloaded.password);
      expect(checkNewPass).toBe(true);
    });

    it('returns false when trying to change password with invalid token', async () => {
      const user = await authService.createUser({ email: 'fakechange@domain.com', password: 'OldPassword1!' });
      const success = await authService.changePassword(user._id.toString(), 'invalidtoken', 'NewPass123!');
      expect(success).toBe(false);
    });
  });
});
