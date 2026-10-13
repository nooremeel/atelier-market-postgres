const request = require('supertest');
const app = require('../../app');
const { Product, User, Order, OrderItem } = require('../../db/models');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let defaultSeller;

beforeAll(() => {
  if (!process.env.PAYMOB_HMAC_SECRET) {
    process.env.PAYMOB_HMAC_SECRET = 'test_paymob_hmac_secret_key_12345';
  }
});

beforeEach(async () => {
  defaultSeller = await User.create({
    name: 'Artisan Paymob Seller',
    email: `paymob-seller-${Date.now()}-${Math.random()}@atelier.com`,
    password: await bcrypt.hash('Passw0rd!x', 4),
    role: 'seller',
  });
});

async function loginAgent(email = 'paymob_user@atelier.com') {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role: 'customer',
  });
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

describe('Paymob Payment Integration API', () => {
  it('rejects initiation if cart is empty', async () => {
    const { agent, csrf } = await loginAgent('empty_paymob@atelier.com');
    const res = await agent.post('/api/paymob/initiate').set('csrf-token', csrf).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empty/i);
  });

  it('initiates Paymob session, creates a pending order, and preserves cart while modal is open', async () => {
    const { agent, csrf } = await loginAgent('initiate_paymob@atelier.com');
    const prod = await Product.create({
      title: 'Handwoven Kilm Runner',
      price: 120,
      stock: 10,
      description: 'Wool runner',
      imageUrl: 'images/kilm.jpg',
      sellerId: defaultSeller.id,
      category: 'textiles',
    });

    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: prod.id });

    const res = await agent.post('/api/paymob/initiate').set('csrf-token', csrf).send({
      shippingAddress: {
        name: 'Fatima Al-Mansoor',
        street: 'Corniche Rd 45',
        city: 'Abu Dhabi',
        country: 'United Arab Emirates',
        postalCode: '00000',
        phone: '+971501234567',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.iframeUrl).toContain('acceptance/iframes');
    expect(res.body.paymentToken).toBeDefined();

    // Verify order was created in 'pending' and 'unpaid' state
    const order = await Order.findByPk(res.body.orderId);
    expect(order).not.toBeNull();
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('unpaid');
    expect(Number(order.totalPrice)).toBe(120);

    // Verify cart was preserved while modal is open (so customer doesn't lose items if dismissed)
    const cartRes = await agent.get('/api/cart');
    expect(cartRes.body.items).toHaveLength(1);

    // Verify canceling removes the unconfirmed draft order
    await agent.post('/api/paymob/cancel').set('csrf-token', csrf).send({ orderId: res.body.orderId });
    const draft = await Order.findByPk(res.body.orderId);
    expect(draft).toBeNull();
  });

  it('processes webhook with HMAC, confirms order, and decrements stock (CSRF exempt)', async () => {
    const user = await User.create({
      email: 'webhook_cust@atelier.com',
      password: await bcrypt.hash('Passw0rd!x', 4),
      role: 'customer',
    });

    const prod = await Product.create({
      title: 'Damascene Inlaid Box',
      price: 85,
      stock: 5,
      description: 'Walnut & mother of pearl',
      imageUrl: 'images/box.jpg',
      sellerId: defaultSeller.id,
      category: 'other',
    });

    const order = await Order.create({
      userId: user.id,
      userEmail: user.email,
      userName: 'Tariq Aziz',
      subtotal: 170,
      totalPrice: 170,
      status: 'pending',
      paymentStatus: 'unpaid',
      shipName: 'Tariq Aziz',
      shipStreet: 'Hamra',
      shipCity: 'Beirut',
      shipCountry: 'Lebanon',
    });

    await OrderItem.create({
      orderId: order.id,
      productId: prod.id,
      quantity: 2,
      productSnapshot: {
        _id: prod.id,
        id: prod.id,
        title: prod.title,
        price: 85,
        sellerId: defaultSeller.id,
      },
    });

    const webhookPayload = {
      obj: {
        id: 7654321,
        success: true,
        order: {
          id: 112233,
          merchant_order_id: order.id.toString(),
        },
        amount_cents: 17000,
        currency: 'USD',
      },
    };

    // Calculate real cryptographic HMAC
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
    const concatenated =
      webhookPayload.obj.amount_cents +
      '' + // created_at
      webhookPayload.obj.currency +
      '' + // error_occured
      '' + // has_parent_transaction
      webhookPayload.obj.id +
      '' + // integration_id
      '' + // is_3d_secure
      '' + // is_auth
      '' + // is_capture
      '' + // is_refunded
      '' + // is_standalone_payment
      '' + // is_voided
      webhookPayload.obj.order.id +
      '' + // owner
      '' + // pending
      '' + // pan
      '' + // sub_type
      '' + // type
      webhookPayload.obj.success;
    const computedHmac = crypto.createHmac('sha512', hmacSecret).update(concatenated).digest('hex');

    const res = await request(app)
      .post(`/api/paymob/webhook?hmac=${computedHmac}`)
      .send(webhookPayload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    // Verify order status is updated to confirmed & paid
    const updatedOrder = await Order.findByPk(order.id);
    expect(updatedOrder.paymentStatus).toBe('paid');
    expect(updatedOrder.status).toBe('confirmed');
    expect(updatedOrder.paymentReference).toBe('PAYMOB-TXN-7654321');

    // Verify product stock was decremented from 5 to 3 (purchased 2)
    const updatedProd = await Product.findByPk(prod.id);
    expect(Number(updatedProd.stock)).toBe(3);
  });

  it('rejects webhooks with invalid HMAC signatures', async () => {
    const res = await request(app)
      .post('/api/paymob/webhook?hmac=tampered_signature')
      .send({ obj: { id: 1234, success: true } });

    expect(res.status).toBe(401);
  });

  it('processes direct card payment submission via /api/paymob/pay', async () => {
    const { agent, csrf } = await loginAgent('direct_pay_user@atelier.com');
    const prod = await Product.create({
      title: 'Ceramic Tea Bowl',
      price: 65,
      stock: 8,
      description: 'Handmade bowl',
      imageUrl: 'images/bowl.jpg',
      sellerId: defaultSeller.id,
      category: 'ceramics',
    });

    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: prod.id });

    // 1. Initiate order
    const initRes = await agent.post('/api/paymob/initiate').set('csrf-token', csrf).send({
      shippingAddress: {
        name: 'Sara Hassan',
        street: 'King Road 10',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        postalCode: '11564',
        phone: '+966501234567',
      },
    });

    expect(initRes.status).toBe(200);
    const { orderId, paymentToken } = initRes.body;

    // 2. Direct card payment
    const payRes = await agent.post('/api/paymob/pay').set('csrf-token', csrf).send({
      orderId,
      paymentToken,
      card: {
        number: '4111111111111111',
        holderName: 'Sara Hassan',
        expiryMonth: '12',
        expiryYear: '28',
        cvv: '123',
      },
    });

    expect(payRes.status).toBe(200);
    expect(payRes.body.success).toBe(true);
  });
});
