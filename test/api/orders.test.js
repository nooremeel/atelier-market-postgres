const request = require('supertest');
const app = require('../../app');
const { Product, ProductVariant, User, Order } = require('../../db/models');
const bcrypt = require('bcryptjs');

let defaultSeller;

beforeEach(async () => {
  defaultSeller = await User.create({
    name: 'Artisan Master',
    email: `seller-${Date.now()}-${Math.random()}@ateliermarket.com`,
    password: await bcrypt.hash('Passw0rd!x', 4),
    role: 'seller',
  });
});

async function loginAgent(email = 'o@b.com') {
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

describe('orders API', () => {
  it('rejects an order with an empty cart', async () => {
    const { agent, csrf } = await loginAgent();
    const res = await agent.post('/api/orders').set('csrf-token', csrf).send({});
    expect(res.status).toBe(400);
  });

  it('places an order, clears the cart, lists it, streams a PDF', async () => {
    const { agent, csrf } = await loginAgent('o2@b.com');
    const p = await Product.create({
      title: 'Zaatar',
      price: 8,
      description: 'Wild thyme blend',
      imageUrl: 'images/z.jpg',
      sellerId: defaultSeller.id,
      category: 'other',
      stock: 20,
    });
    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });

    let res = await agent.post('/api/orders').set('csrf-token', csrf).send({});
    expect(res.status).toBe(201);
    expect(res.body.order.totalPrice).toBe(8);
    expect(res.body.order.status).toBe('confirmed');
    expect(res.body.order.carrier).toBe('Aramex White-Glove Express');
    expect(res.body.order.timeline).toHaveLength(1);
    expect(res.body.order.timeline[0].status).toBe('confirmed');

    res = await agent.get('/api/cart');
    expect(res.body.items).toHaveLength(0);

    res = await agent.get('/api/orders');
    expect(res.body.orders).toHaveLength(1);
    const orderId = res.body.orders[0]._id;

    res = await agent.get(`/api/orders/${orderId}/invoice`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });

  it('saves contact info, default address, and payment preferences to profile when requested', async () => {
    const { agent, csrf } = await loginAgent('saveprofile@b.com');
    const p = await Product.create({
      title: 'Ceramic Vase',
      price: 45,
      description: 'Handcrafted stoneware vase',
      imageUrl: 'images/vase.jpg',
      sellerId: defaultSeller.id,
      category: 'ceramics',
      stock: 20,
    });
    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });

    const res = await agent.post('/api/orders').set('csrf-token', csrf).send({
      shippingAddress: {
        name: 'Nour El-Din',
        street: '12 Al-Gezira St',
        city: 'Zamalek, Cairo',
        country: 'Egypt',
        postalCode: '11211',
        phone: '+20 100 123 4567',
      },
      paymentMethod: 'card',
      paymentDetails: {
        cardNumber: '4242 4242 4242 9876',
        cardholderName: 'Nour El-Din',
        expiry: '09/29',
      },
      saveToProfile: {
        saveContactInfo: true,
        saveDefaultAddress: true,
        saveDefaultPayment: true,
      },
    });

    expect(res.status).toBe(201);

    // Verify user profile reflects saved details
    const profileRes = await agent.get('/api/account/profile');
    expect(profileRes.status).toBe(200);
    const u = profileRes.body.user;
    expect(u.name).toBe('Nour El-Din');
    expect(u.phone).toBe('+20 100 123 4567');
    expect(u.address.street).toBe('12 Al-Gezira St');
    expect(u.address.city).toBe('Zamalek, Cairo');
    expect(u.defaultPaymentMethod).toBe('card');
    expect(u.savedCard).toEqual({
      cardholderName: 'Nour El-Din',
      last4: '9876',
      brand: 'Visa',
      expiry: '09/29',
    });
    expect(u.addresses).toHaveLength(1);
    expect(u.addresses[0].isDefault).toBe(true);
    expect(u.addresses[0].street).toBe('12 Al-Gezira St');
  });

  it('decrements stock of purchased products upon order placement', async () => {
    const { agent, csrf } = await loginAgent('stockdecrement@b.com');
    const p = await Product.create({
      title: 'Handmade Silk Scarf',
      price: 90,
      description: 'Natural dye silk',
      imageUrl: 'images/silk.jpg',
      sellerId: defaultSeller.id,
      stock: 10,
    });

    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });
    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });

    const res = await agent.post('/api/orders').set('csrf-token', csrf).send({});
    expect(res.status).toBe(201);

    const updated = await Product.findByPk(p.id);
    expect(Number(updated.stock)).toBe(8);
  });

  it('rejects order placement if a product in cart is sold out', async () => {
    const { agent, csrf } = await loginAgent('soldoutorder@b.com');
    const p = await Product.create({
      title: 'Copper Lamp',
      price: 150,
      description: 'Hand-hammered lamp',
      imageUrl: 'images/lamp.jpg',
      sellerId: defaultSeller.id,
      stock: 1,
    });

    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });

    // Simulate product selling out before checkout
    p.stock = 0;
    await p.save();

    const res = await agent.post('/api/orders').set('csrf-token', csrf).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sold out/i);
  });

  it('allows admin to download any invoice, but forbids non-owner customers', async () => {
    const { agent: customerAgent, csrf: customerCsrf } = await loginAgent('customer_inv@b.com');
    const p = await Product.create({
      title: 'Ceramic Pitcher',
      price: 60,
      description: 'Earthy glaze',
      imageUrl: 'images/p.jpg',
      sellerId: defaultSeller.id,
      stock: 10,
    });
    await customerAgent.post('/api/cart').set('csrf-token', customerCsrf).send({ productId: p.id });
    const orderRes = await customerAgent.post('/api/orders').set('csrf-token', customerCsrf).send({});
    const orderId = orderRes.body.order._id;

    const { agent: otherCustomerAgent } = await loginAgent('other_cust@b.com');
    const forbiddenRes = await otherCustomerAgent.get(`/api/orders/${orderId}/invoice`);
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.message).toMatch(/Not authorized/i);

    const adminAgent = request.agent(app);
    const adminPassword = 'Passw0rd!admin';
    await User.create({
      email: 'admin_inv@b.com',
      password: await bcrypt.hash(adminPassword, 4),
      role: 'admin',
    });
    const adminCsrf = (await adminAgent.get('/api/csrf-token')).body.csrfToken;
    await adminAgent.post('/api/auth/login').set('csrf-token', adminCsrf).send({
      email: 'admin_inv@b.com',
      password: adminPassword,
    });

    const adminInvoiceRes = await adminAgent.get(`/api/orders/${orderId}/invoice`);
    expect(adminInvoiceRes.status).toBe(200);
    expect(adminInvoiceRes.headers['content-type']).toMatch(/pdf/);
  });

  it('generates a luxury PDF invoice with discounts and shipping fees', async () => {
    const { agent, csrf } = await loginAgent('discount_inv@b.com');
    const p = await Product.create({
      title: 'Artisanal Terracotta Vessel',
      price: 100,
      description: 'Hand-thrown clay vessel from Bahrain',
      imageUrl: 'images/vessel.jpg',
      sellerId: defaultSeller.id,
      stock: 10,
    });
    await agent.post('/api/cart').set('csrf-token', csrf).send({ productId: p.id });
    const orderRes = await agent.post('/api/orders').set('csrf-token', csrf).send({
      shippingFee: 15,
      shippingAddress: {
        name: 'Sara Patron',
        street: '42 Royal Avenue',
        city: 'Dubai',
        country: 'UAE',
        postalCode: '00000',
      },
    });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.order.shippingFee).toBe(15);
    const orderId = orderRes.body.order._id;

    // Update with discount to verify discount rendering in invoice
    await Order.update(
      {
        discountCode: 'SAVE10',
        discountAmount: 10,
        discountType: 'percentage',
        discountValue: 10,
        shippingFee: 15,
        totalPrice: 105,
      },
      { where: { id: orderId } }
    );

    const res = await agent.get(`/api/orders/${orderId}/invoice`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.headers['content-disposition']).toMatch(/inline; filename="invoice-/);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('places order with variant line item and decrements variant stock', async () => {
    const { agent, csrf } = await loginAgent('variant_order@b.com');
    const p = await Product.create({
      title: 'Silk Scarf',
      price: 150,
      description: 'Hand-woven raw silk',
      imageUrl: 'images/silk.jpg',
      sellerId: defaultSeller.id,
      stock: 10,
    });
    const emeraldVar = await ProductVariant.create({
      productId: p.id,
      name: 'Emerald / Gold',
      sku: 'SCARF-EM',
      price: 175,
      stock: 4,
    });
    await ProductVariant.create({
      productId: p.id,
      name: 'Indigo / Silver',
      sku: 'SCARF-IN',
      price: 165,
      stock: 6,
    });

    // Add 2 of emerald variant to cart
    await agent.post('/api/cart').set('csrf-token', csrf).send({
      productId: p.id,
      variantId: emeraldVar.id,
      quantity: 2,
    });

    const orderRes = await agent.post('/api/orders').set('csrf-token', csrf).send({
      shippingFee: 20,
    });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.order.subtotal).toBe(350); // 175 * 2
    expect(orderRes.body.order.totalPrice).toBe(370); // 350 + 20
    expect(orderRes.body.order.products[0].variant.name).toBe('Emerald / Gold');
    expect(orderRes.body.order.products[0].variant.price).toBe(175);

    // Verify stock decrement in database
    const updatedProd = await Product.findByPk(p.id);
    const updatedEmerald = await ProductVariant.findByPk(emeraldVar.id);
    expect(Number(updatedEmerald.stock)).toBe(2); // 4 - 2
    expect(Number(updatedProd.stock)).toBe(8); // 10 - 2
  });
});
