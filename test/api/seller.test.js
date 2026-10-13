const request = require('supertest');
const app = require('../../app');
const { User, Product, Order, OrderItem, SellerProfile } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function createAgent(email, role = 'seller', sellerProfile = {}) {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role,
    name: email.split('@')[0],
  });
  if (role === 'seller') {
    await SellerProfile.create({
      userId: user.id,
      shopName: `${email.split('@')[0]} Studio`,
      shopDescription: 'Artisanal crafts',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      ...sellerProfile,
    });
  }
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

describe('Seller API', () => {
  describe('Authorization guards', () => {
    it('returns 401 when unauthenticated', async () => {
      expect((await request(app).get('/api/seller/stats')).status).toBe(401);
      expect((await request(app).get('/api/seller/orders')).status).toBe(401);
      expect((await request(app).get('/api/seller/profile')).status).toBe(401);
    });

    it('returns 403 when authenticated as a customer', async () => {
      const { agent } = await createAgent('customer1@shop.com', 'customer');
      const resStats = await agent.get('/api/seller/stats');
      expect(resStats.status).toBe(403);
      expect(resStats.body.message).toMatch(/Forbidden/i);

      const resOrders = await agent.get('/api/seller/orders');
      expect(resOrders.status).toBe(403);

      const resProfile = await agent.get('/api/seller/profile');
      expect(resProfile.status).toBe(403);
    });
  });

  describe('GET /api/seller/stats', () => {
    it('accurately aggregates revenue, product counts, and orders for the seller', async () => {
      const { agent: sellerA, user: userA } = await createAgent('seller_a@shop.com', 'seller');
      const { user: userB } = await createAgent('seller_b@shop.com', 'seller');
      const { user: customer } = await createAgent('buyer@shop.com', 'customer');

      // Create products for Seller A
      const prodA1 = await Product.create({
        title: 'Ceramic Jar',
        price: 120,
        description: 'Handmade stoneware jar',
        imageUrl: 'images/test.jpg',
        sellerId: userA.id,
        category: 'ceramics',
        ratingAverage: 4.8,
        ratingCount: 5,
      });

      const prodA2 = await Product.create({
        title: 'Porcelain Cup',
        price: 40,
        description: 'Delicate porcelain tea cup',
        imageUrl: 'images/test2.jpg',
        sellerId: userA.id,
        category: 'ceramics',
        ratingAverage: 5.0,
        ratingCount: 3,
      });

      // Create product for Seller B
      const prodB = await Product.create({
        title: 'Leather Wallet',
        price: 90,
        description: 'Vegetable-tanned leather wallet',
        imageUrl: 'images/test3.jpg',
        sellerId: userB.id,
        category: 'leather',
        ratingAverage: 4.5,
        ratingCount: 2,
      });

      // Order 1: Paid order containing prodA1 (qty 2) + prodB (qty 1)
      const order1 = await Order.create({
        userId: customer.id,
        userEmail: customer.email,
        userName: 'Buyer',
        subtotal: 330,
        totalPrice: 330,
        status: 'delivered',
        paymentStatus: 'paid',
        shipCity: 'Riyadh',
        shipCountry: 'Saudi Arabia',
      });
      await OrderItem.create({
        orderId: order1.id,
        productId: prodA1.id,
        quantity: 2,
        productSnapshot: {
          _id: prodA1.id,
          id: prodA1.id,
          title: prodA1.title,
          price: 120,
          sellerId: userA.id,
        },
      });
      await OrderItem.create({
        orderId: order1.id,
        productId: prodB.id,
        quantity: 1,
        productSnapshot: {
          _id: prodB.id,
          id: prodB.id,
          title: prodB.title,
          price: 90,
          sellerId: userB.id,
        },
      });

      // Order 2: Pending/unpaid order containing prodA2 (qty 1)
      const order2 = await Order.create({
        userId: customer.id,
        userEmail: customer.email,
        userName: 'Buyer',
        subtotal: 40,
        totalPrice: 40,
        status: 'pending',
        paymentStatus: 'unpaid',
      });
      await OrderItem.create({
        orderId: order2.id,
        productId: prodA2.id,
        quantity: 1,
        productSnapshot: {
          _id: prodA2.id,
          id: prodA2.id,
          title: prodA2.title,
          price: 40,
          sellerId: userA.id,
        },
      });

      const resA = await sellerA.get('/api/seller/stats');
      expect(resA.status).toBe(200);
      expect(resA.body.stats).toBeDefined();
      expect(resA.body.stats.totalProducts).toBe(2);
      expect(resA.body.stats.totalOrders).toBe(2);
      expect(resA.body.stats.pendingOrdersCount).toBe(1);
      // Revenue is only counted for paid / delivered orders: 120 * 2 = 240
      expect(resA.body.stats.totalRevenue).toBe(240);
      expect(resA.body.stats.averageRating).toBe(4.9); // (4.8 + 5.0) / 2
      expect(resA.body.recentOrders).toHaveLength(2);
      expect(resA.body.recentOrders[0].sellerTotal).toBeDefined();
    });
  });

  describe('GET /api/seller/orders', () => {
    it('returns only orders containing seller products with seller-scoped line items', async () => {
      const { agent: sellerA, user: userA } = await createAgent('seller_orders_a@shop.com', 'seller');
      const { agent: sellerB, user: userB } = await createAgent('seller_orders_b@shop.com', 'seller');
      const { user: customer } = await createAgent('buyer_orders@shop.com', 'customer');

      const prodA = await Product.create({
        title: 'Woven Linen Throw',
        price: 150,
        description: 'Fine Belgian linen throw',
        imageUrl: 'images/linen.jpg',
        sellerId: userA.id,
        category: 'textiles',
      });

      const prodB = await Product.create({
        title: 'Glass Decanter',
        price: 85,
        description: 'Hand-blown glass decanter',
        imageUrl: 'images/glass.jpg',
        sellerId: userB.id,
        category: 'glass',
      });

      // Combined order
      const combinedOrder = await Order.create({
        userId: customer.id,
        userEmail: customer.email,
        userName: 'Alice Walker',
        subtotal: 320,
        totalPrice: 320,
        status: 'confirmed',
        paymentStatus: 'paid',
        shipCity: 'London',
        shipCountry: 'UK',
      });
      await OrderItem.create({
        orderId: combinedOrder.id,
        productId: prodA.id,
        quantity: 1,
        productSnapshot: {
          _id: prodA.id,
          id: prodA.id,
          title: prodA.title,
          price: 150,
          sellerId: userA.id,
        },
      });
      await OrderItem.create({
        orderId: combinedOrder.id,
        productId: prodB.id,
        quantity: 2,
        productSnapshot: {
          _id: prodB.id,
          id: prodB.id,
          title: prodB.title,
          price: 85,
          sellerId: userB.id,
        },
      });

      // Exclusive order for B
      const exclusiveB = await Order.create({
        userId: customer.id,
        userEmail: customer.email,
        userName: 'Alice Walker',
        subtotal: 85,
        totalPrice: 85,
        status: 'pending',
        paymentStatus: 'paid',
      });
      await OrderItem.create({
        orderId: exclusiveB.id,
        productId: prodB.id,
        quantity: 1,
        productSnapshot: {
          _id: prodB.id,
          id: prodB.id,
          title: prodB.title,
          price: 85,
          sellerId: userB.id,
        },
      });

      // Seller A should see only combinedOrder with only their item
      const resA = await sellerA.get('/api/seller/orders');
      expect(resA.status).toBe(200);
      expect(resA.body.orders).toHaveLength(1);
      expect(resA.body.orders[0]._id.toString()).toBe(combinedOrder.id.toString());
      expect(resA.body.orders[0].products).toHaveLength(1);
      expect(resA.body.orders[0].products[0].productData.title).toBe('Woven Linen Throw');
      expect(resA.body.orders[0].sellerSubtotal).toBe(150);
      expect(resA.body.orders[0].orderTotal).toBe(320);

      // Seller B should see both orders
      const resB = await sellerB.get('/api/seller/orders');
      expect(resB.status).toBe(200);
      expect(resB.body.orders).toHaveLength(2);

      // Filter by status=pending for Seller B
      const resBPending = await sellerB.get('/api/seller/orders?status=pending');
      expect(resBPending.status).toBe(200);
      expect(resBPending.body.orders).toHaveLength(1);
      expect(resBPending.body.orders[0].status).toBe('pending');
    });
  });

  describe('PATCH /api/seller/orders/:orderId/status', () => {
    it('allows a seller to update the status and tracking number of an order containing their item', async () => {
      const { agent: sellerA, csrf: csrfA, user: userA } = await createAgent('seller_up_a@shop.com', 'seller');
      const { agent: sellerUnrelated, csrf: csrfUnrelated } = await createAgent('seller_unrelated@shop.com', 'seller');
      const { user: customer } = await createAgent('buyer_up@shop.com', 'customer');

      const prodA = await Product.create({
        title: 'Bronze Mortar',
        price: 210,
        description: 'Cast bronze kitchen mortar',
        imageUrl: 'images/mortar.jpg',
        sellerId: userA.id,
        category: 'metals',
      });

      const order = await Order.create({
        userId: customer.id,
        userEmail: customer.email,
        userName: 'Collector',
        subtotal: 210,
        totalPrice: 210,
        status: 'pending',
        paymentStatus: 'paid',
      });
      await OrderItem.create({
        orderId: order.id,
        productId: prodA.id,
        quantity: 1,
        productSnapshot: {
          _id: prodA.id,
          id: prodA.id,
          title: prodA.title,
          price: 210,
          sellerId: userA.id,
        },
      });

      // Unrelated seller cannot modify this order
      const resForbidden = await sellerUnrelated
        .patch(`/api/seller/orders/${order.id}/status`)
        .set('csrf-token', csrfUnrelated)
        .send({ status: 'shipped', trackingNumber: 'TRK-9999' });
      expect(resForbidden.status).toBe(403);

      // Seller A modifies status to 'crafting' with custom note and carrier
      const resCrafting = await sellerA
        .patch(`/api/seller/orders/${order.id}/status`)
        .set('csrf-token', csrfA)
        .send({
          status: 'crafting',
          carrier: 'Aramex White-Glove Express',
          note: 'Hand-chiseling the bronze mortar in the forge.',
        });

      expect(resCrafting.status).toBe(200);
      expect(resCrafting.body.order.status).toBe('crafting');
      expect(resCrafting.body.order.carrier).toBe('Aramex White-Glove Express');
      expect(resCrafting.body.order.timeline).toHaveLength(1);
      expect(resCrafting.body.order.timeline[0].status).toBe('crafting');
      expect(resCrafting.body.order.timeline[0].note).toBe('Hand-chiseling the bronze mortar in the forge.');

      // Seller A modifies status to 'shipped' with tracking number
      const resOk = await sellerA
        .patch(`/api/seller/orders/${order.id}/status`)
        .set('csrf-token', csrfA)
        .send({ status: 'shipped', trackingNumber: 'DHL-EXPRESS-10293' });

      expect(resOk.status).toBe(200);
      expect(resOk.body.order.status).toBe('shipped');
      expect(resOk.body.order.trackingNumber).toBe('DHL-EXPRESS-10293');
      expect(resOk.body.order.timeline).toHaveLength(2);
      expect(resOk.body.order.timeline[1].status).toBe('shipped');

      // Invalid status test
      const resInvalid = await sellerA
        .patch(`/api/seller/orders/${order.id}/status`)
        .set('csrf-token', csrfA)
        .send({ status: 'bogus_status' });
      expect(resInvalid.status).toBe(422);
    });
  });

  describe('GET & PATCH /api/seller/profile', () => {
    it('fetches and updates seller studio profile', async () => {
      const { agent, csrf } = await createAgent('seller_prof@shop.com', 'seller');

      const getRes = await agent.get('/api/seller/profile');
      expect(getRes.status).toBe(200);
      expect(getRes.body.seller.sellerProfile.shopName).toBe('seller_prof Studio');

      const patchRes = await agent
        .patch('/api/seller/profile')
        .set('csrf-token', csrf)
        .send({
          shopName: 'Atelier Al-Noor',
          shopDescription: 'Master ceramicist specializing in wood-fired earthen vessels.',
          city: 'Manama',
          country: 'Bahrain',
          name: 'Noor Al-Sabah',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.seller.name).toBe('Noor Al-Sabah');
      expect(patchRes.body.seller.sellerProfile.shopName).toBe('Atelier Al-Noor');
      expect(patchRes.body.seller.sellerProfile.location.city).toBe('Manama');
      expect(patchRes.body.seller.sellerProfile.location.country).toBe('Bahrain');
    });
  });
});
