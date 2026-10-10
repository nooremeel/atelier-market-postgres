const express = require('express');
const { check, body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const authController = require('../controllers/auth');
const { User } = require('../db/models');
const router = express.Router();

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        message: 'Too many authentication attempts from this IP, please try again after 15 minutes.'
    }
});

router.post(
    '/login',
    authLimiter,
    [
        body('email')
            .isEmail()
            .withMessage('Please enter a valid email address.')
            .normalizeEmail(),
        body('password')
            .trim()
    ],
    authController.postLogin
);

router.post('/signup', authLimiter, [
    check('email')
        .isString().withMessage('The email you entered is invalid, please enter a valid email')
        .isEmail().withMessage('The email you entered is invalid, please enter a valid email')
        .bail()
        .normalizeEmail()
        .custom((value, { req }) => {
            return User.findOne({ where: { email: value.toLowerCase().trim() } })
                .then(userDoc => {
                    if (userDoc) {
                        return Promise.reject('Email already exists');
                    }
                });
        }),
    body('password')
        .isStrongPassword()
        .withMessage('Please make sure your password has at least 8 characters, At least 1 uppercase letter, At least 1 lowercase letter, At least 1 number, and At least 1 symbol')
        .trim(),
    body('confirmPassword')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Password does not match');
            }
            return true
        }).trim(),
    body('role')
        .optional()
        .isIn(['customer', 'seller'])
        .withMessage('Role must be either customer or seller')
], authController.postSignup);

router.post('/logout', authController.postLogout);

router.post(
    '/reset-password',
    authLimiter,
    [ body('email').isEmail().withMessage('Please enter a valid email address.').normalizeEmail() ],
    authController.postReset
);

router.get('/reset-password/:token', authController.getResetToken);

router.post(
    '/change-password',
    authLimiter,
    [
        body('userId').isUUID().withMessage('Invalid request'),
        body('passwordToken').isString().matches(/^[a-f0-9]{64}$/).withMessage('Invalid or malformed reset token'),
        body('password').isStrongPassword().withMessage('Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol'),
    ],
    authController.postChangePassword
);

module.exports = router;