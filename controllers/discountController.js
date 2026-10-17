const { Op } = require('sequelize');
const { Discount } = require('../db/models');

exports.postValidateDiscount = async (req, res, next) => {
  try {
    const { code, subtotal } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Please provide a discount code.' });
    }
    const cleanCode = code.trim().toUpperCase();
    const numericSubtotal = Number(subtotal) || 0;

    const discount = await Discount.findOne({ where: { code: cleanCode } });
    if (!discount || !discount.isActive) {
      return res.status(404).json({ valid: false, message: 'Invalid or inactive promo code.' });
    }

    const now = new Date();
    if (discount.startDate && now < discount.startDate) {
      return res.status(400).json({ valid: false, message: 'This promo code is not yet active.' });
    }
    if (discount.endDate && now > discount.endDate) {
      return res.status(400).json({ valid: false, message: 'This promo code has expired.' });
    }
    if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) {
      return res.status(400).json({ valid: false, message: 'This promo code has reached its maximum redemptions.' });
    }
    const minOrder = Number(discount.minOrderAmount) || 0;
    if (numericSubtotal < minOrder) {
      return res.status(400).json({
        valid: false,
        message: `A minimum order amount of $${minOrder.toFixed(2)} is required to use this code.`,
      });
    }

    const discountValue = Number(discount.discountValue) || 0;
    let amount = 0;
    if (discount.discountType === 'percentage') {
      amount = Math.round((numericSubtotal * (discountValue / 100)) * 100) / 100;
      const maxDisc = discount.maxDiscount != null ? Number(discount.maxDiscount) : null;
      if (maxDisc && amount > maxDisc) {
        amount = maxDisc;
      }
    } else {
      amount = Math.min(numericSubtotal, discountValue);
    }

    const finalTotal = Math.max(0, Math.round((numericSubtotal - amount) * 100) / 100);

    return res.json({
      valid: true,
      discount: {
        code: discount.code,
        description: discount.description,
        discountType: discount.discountType,
        discountValue,
        amount,
      },
      subtotal: numericSubtotal,
      finalTotal,
    });
  } catch (err) {
    next(err);
  }
};

exports.getDiscounts = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const where = req.user.role === 'admin'
      ? {}
      : { [Op.or]: [{ sellerId: userId }, { sellerId: null }] };

    const discounts = await Discount.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });
    res.json({ discounts });
  } catch (err) {
    next(err);
  }
};

exports.postCreateDiscount = async (req, res, next) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscount,
      startDate,
      endDate,
      usageLimit,
    } = req.body;

    if (!code || !code.trim()) {
      return res.status(422).json({ message: 'Promo code is required.' });
    }
    const cleanCode = code.trim().toUpperCase();

    const existing = await Discount.findOne({ where: { code: cleanCode } });
    if (existing) {
      return res.status(422).json({ message: `Promo code "${cleanCode}" already exists.` });
    }

    const numericValue = Number(discountValue);
    if (isNaN(numericValue) || numericValue <= 0) {
      return res.status(422).json({ message: 'Discount value must be greater than zero.' });
    }
    if (discountType === 'percentage' && numericValue > 100) {
      return res.status(422).json({ message: 'Percentage discount cannot exceed 100%.' });
    }

    const userId = req.user.id || req.user._id;
    const saved = await Discount.create({
      code: cleanCode,
      description: description ? description.trim() : '',
      discountType: discountType === 'fixed' ? 'fixed' : 'percentage',
      discountValue: numericValue,
      minOrderAmount: Number(minOrderAmount) || 0,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      sellerId: req.user.role === 'admin' ? (req.body.sellerId || null) : userId,
      isActive: true,
    });

    res.status(201).json({ message: 'Promo code created successfully.', discount: saved });
  } catch (err) {
    next(err);
  }
};

exports.patchToggleDiscount = async (req, res, next) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: 'Promo code not found.' });
    }
    const userId = req.user.id || req.user._id;
    if (req.user.role !== 'admin' && (!discount.sellerId || discount.sellerId !== userId)) {
      return res.status(403).json({ message: 'Not authorized to modify this promo code.' });
    }

    discount.isActive = !discount.isActive;
    const saved = await discount.save();
    res.json({ message: `Promo code ${saved.isActive ? 'activated' : 'deactivated'}.`, discount: saved });
  } catch (err) {
    next(err);
  }
};

exports.deleteDiscount = async (req, res, next) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: 'Promo code not found.' });
    }
    const userId = req.user.id || req.user._id;
    if (req.user.role !== 'admin' && (!discount.sellerId || discount.sellerId !== userId)) {
      return res.status(403).json({ message: 'Not authorized to delete this promo code.' });
    }

    await discount.destroy();
    res.json({ message: 'Promo code deleted successfully.' });
  } catch (err) {
    next(err);
  }
};
