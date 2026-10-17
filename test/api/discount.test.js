const request = require('supertest');
const path = require('path');
const app = require('../../app');
const { User, Product, Discount, Order, SellerProfile } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function authAgent(email = 'seller@shop.com', role = 'seller') {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role,
    name: 'Artisan User',
  });
  if (role === 'seller') {
    await SellerProfile.findOrCreate({
      where: { userId: user.id },
      defaults: { userId: user.id, shopName: 'Artisan Workshop' },
    });
  }
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

describe('Discounts & Promo Codes API', () => {
  describe('Seller Product Discounts', () => {
    it('applies and removes percentage and fixed discounts on an owned product', async () => {
      const { agent, csrf, user } = await authAgent('artisan1@shop.com', 'seller');

      const product = await Product.create({
        title: 'Ceramic Vase',
        price: 100,
        description: 'Handmade terracotta vase.',
        imageUrl: '/images/vase.jpg',
        sellerId: user._id,
      });

      // 1. Apply 20% discount
      let res = await agent
        .post(`/api/admin/products/${product._id}/discount`)
        .set('csrf-token', csrf)
        .send({ type: 'percentage', value: 20 });

      expect(res.status).toBe(200);
      expect(res.body.product.price).toBe(80);
      expect(res.body.product.compareAtPrice).toBe(100);
      expect(res.body.product.badge).toBe('sale');
      expect(res.body.product.discount.isActive).toBe(true);
      expect(res.body.product.discount.value).toBe(20);

      // Verify in database
      let dbProduct = await Product.findById(product._id);
      expect(dbProduct.price).toBe(80);
      expect(dbProduct.compareAtPrice).toBe(100);
      expect(dbProduct.badge).toBe('sale');

      // 2. Remove discount and restore original price
      res = await agent
        .delete(`/api/admin/products/${product._id}/discount`)
        .set('csrf-token', csrf);

      expect(res.status).toBe(200);
      expect(res.body.product.price).toBe(100);
      expect(res.body.product.compareAtPrice).toBeNull();
      expect(res.body.product.badge).toBe('');
      expect(res.body.product.discount.isActive).toBe(false);

      dbProduct = await Product.findById(product._id);
      expect(dbProduct.price).toBe(100);
      expect(dbProduct.compareAtPrice).toBeNull();

      // 3. Apply fixed $25 discount
      res = await agent
        .post(`/api/admin/products/${product._id}/discount`)
        .set('csrf-token', csrf)
        .send({ type: 'fixed', value: 25 });

      expect(res.status).toBe(200);
      expect(res.body.product.price).toBe(75);
      expect(res.body.product.compareAtPrice).toBe(100);
    });

    it('prevents non-owner from applying discount to another seller product', async () => {
      const { user: seller1 } = await authAgent('owner@shop.com', 'seller');
      const { agent: otherSeller, csrf: otherCsrf } = await authAgent('other@shop.com', 'seller');

      const product = await Product.create({
        title: 'Artisan Glass',
        price: 80,
        description: 'Blown glassware.',
        imageUrl: '/images/glass.jpg',
        sellerId: seller1._id,
      });

      const res = await otherSeller
        .post(`/api/admin/products/${product._id}/discount`)
        .set('csrf-token', otherCsrf)
        .send({ type: 'percentage', value: 15 });

      expect(res.status).toBe(403);
    });
  });

  describe('Promo Code Engine', () => {
    it('validates percentage and fixed promo codes and enforces constraints', async () => {
      const { agent, csrf, user } = await authAgent('customer1@shop.com', 'customer');

      // Create sample promo codes
      await Discount.bulkCreate([
        {
          code: 'WELCOME10',
          discountType: 'percentage',
          discountValue: 10,
          minOrderAmount: 50,
          isActive: true,
        },
        {
          code: 'CRAFT20',
          discountType: 'fixed',
          discountValue: 20,
          minOrderAmount: 100,
          isActive: true,
        },
        {
          code: 'EXPIRED',
          discountType: 'percentage',
          discountValue: 25,
          endDate: new Date('2020-01-01'),
          isActive: true,
        },
        {
          code: 'MAXEDOUT',
          discountType: 'percentage',
          discountValue: 15,
          usageLimit: 1,
          usedCount: 1,
          isActive: true,
        },
      ]);

      // 1. Valid 10% discount on $200
      let res = await agent
        .post('/api/discounts/validate')
        .set('csrf-token', csrf)
        .send({ code: 'WELCOME10', subtotal: 200 });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.discount.amount).toBe(20);
      expect(res.body.finalTotal).toBe(180);

      // 2. Below minimum order requirement
      res = await agent
        .post('/api/discounts/validate')
        .set('csrf-token', csrf)
        .send({ code: 'WELCOME10', subtotal: 30 });

      expect(res.status).toBe(400);
      expect(res.body.valid).toBe(false);
      expect(res.body.message).toMatch(/minimum order/i);

      // 3. Expired code
      res = await agent
        .post('/api/discounts/validate')
        .set('csrf-token', csrf)
        .send({ code: 'EXPIRED', subtotal: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);

      // 4. Usage limit exceeded
      res = await agent
        .post('/api/discounts/validate')
        .set('csrf-token', csrf)
        .send({ code: 'MAXEDOUT', subtotal: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/maximum redemptions/i);
    });

    it('persists discount details on orders and increments usedCount', async () => {
      const { agent, csrf, user } = await authAgent('shopper@shop.com', 'customer');
      const { user: seller } = await authAgent('craftsman@shop.com', 'seller');

      const product = await Product.create({
        title: 'Leather Journal',
        price: 150,
        description: 'Full-grain leather.',
        imageUrl: '/images/journal.jpg',
        sellerId: seller._id,
      });

      const discount = await Discount.create({
        code: 'HERITAGE20',
        discountType: 'percentage',
        discountValue: 20,
        minOrderAmount: 100,
        isActive: true,
      });

      // Add to cart
      await agent
        .post('/api/cart')
        .set('csrf-token', csrf)
        .send({ productId: product._id });

      // Place order with discountCode
      const res = await agent
        .post('/api/orders')
        .set('csrf-token', csrf)
        .send({
          discountCode: 'HERITAGE20',
          shippingAddress: {
            name: 'Shopper Name',
            street: '123 Artisan Way',
            city: 'Dubai',
            country: 'UAE',
            postalCode: '00000',
          },
          paymentMethod: 'card',
        });

      expect(res.status).toBe(201);
      expect(res.body.order.subtotal).toBe(150);
      expect(res.body.order.discount.code).toBe('HERITAGE20');
      expect(res.body.order.discount.amount).toBe(30); // 20% of 150
      expect(res.body.order.totalPrice).toBe(120);

      // Verify in DB
      const dbOrder = await Order.findById(res.body.order._id);
      expect(dbOrder.subtotal).toBe(150);
      expect(dbOrder.discount.code).toBe('HERITAGE20');
      expect(dbOrder.discount.amount).toBe(30);
      expect(dbOrder.totalPrice).toBe(120);

      // Verify discount usedCount incremented
      const dbDiscount = await Discount.findById(discount._id);
      expect(dbDiscount.usedCount).toBe(1);
    });
  });
});
