const request = require('supertest');
const path = require('path');
const app = require('../../app');
const { User, Product, Order, OrderItem, SellerProfile } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function adminAgent(email = 'admin@shop.com', role = 'admin') {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role,
  });
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'pixel.png');

describe('admin products API', () => {
  it('401 when logged out', async () => {
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
  });

  it('403 when logged in as customer', async () => {
    const { agent } = await adminAgent('customer@shop.com', 'customer');
    const res = await agent.get('/api/admin/products');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Forbidden/i);
  });

  it('creates, lists, reads, updates, deletes an owned product', async () => {
    const { agent, csrf } = await adminAgent();

    let res = await agent.post('/api/admin/products')
      .set('csrf-token', csrf)
      .field('title', 'Amber Mist')
      .field('price', '42.50')
      .field('description', 'A warm amber fragrance')
      .attach('image', FIXTURE);
    expect(res.status).toBe(201);
    const id = res.body.product._id;

    res = await agent.get('/api/admin/products');
    expect(res.body.products).toHaveLength(1);

    res = await agent.put(`/api/admin/products/${id}`)
      .set('csrf-token', csrf)
      .field('title', 'Amber Mist II')
      .field('price', '45')
      .field('description', 'A warmer amber fragrance');
    expect(res.status).toBe(200);
    expect(res.body.product.title).toBe('Amber Mist II');

    res = await agent.delete(`/api/admin/products/${id}`).set('csrf-token', csrf);
    expect(res.status).toBe(200);
  });

  it('422 on missing image at create', async () => {
    const { agent, csrf } = await adminAgent('a2@shop.com');
    const res = await agent.post('/api/admin/products')
      .set('csrf-token', csrf)
      .field('title', 'No Image')
      .field('price', '10')
      .field('description', 'Missing the file');
    expect(res.status).toBe(422);
  });
});

describe('Platform Admin Dedicated API', () => {
  it('rejects sellers from accessing platform stats with 403', async () => {
    const { agent } = await adminAgent('seller1@shop.com', 'seller');
    const res = await agent.get('/api/admin/stats');
    expect(res.status).toBe(403);
  });

  it('returns aggregated platform statistics for admin', async () => {
    const { agent, user: adminUser } = await adminAgent('superadmin@shop.com', 'admin');
    
    // Seed a product from another seller
    const otherSeller = await User.create({
      name: 'Artisan Zayd',
      email: 'zayd@shop.com',
      password: await bcrypt.hash('hash', 4),
      role: 'seller',
    });
    await SellerProfile.create({
      userId: otherSeller.id,
      shopName: 'Zayd Pottery',
    });

    const product = await Product.create({
      title: 'Zayd Glazed Jar',
      price: 150,
      description: 'Handmade jar',
      imageUrl: 'images/jar.jpg',
      sellerId: otherSeller.id,
      category: 'ceramics',
    });

    // Seed an order
    const order = await Order.create({
      userId: adminUser.id,
      userEmail: 'buyer@shop.com',
      userName: 'Buyer',
      subtotal: 300,
      totalPrice: 300,
      status: 'confirmed',
      paymentStatus: 'paid',
    });

    await OrderItem.create({
      orderId: order.id,
      productId: product.id,
      quantity: 2,
      productSnapshot: {
        _id: product.id,
        id: product.id,
        title: product.title,
        price: 150,
        sellerId: otherSeller.id,
      },
    });

    const res = await agent.get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      totalRevenue: 300,
      totalOrders: 1,
      totalProducts: 1,
      totalArtisans: 1,
    });
    expect(res.body.recentOrders).toHaveLength(1);
    expect(res.body.topArtisans).toHaveLength(1);
    expect(res.body.topArtisans[0].shopName).toBe('Zayd Pottery');
  });

  it('allows admin to view all orders and all artisans', async () => {
    const { agent } = await adminAgent('auditadmin@shop.com', 'admin');
    const ordersRes = await agent.get('/api/admin/orders');
    expect(ordersRes.status).toBe(200);
    expect(Array.isArray(ordersRes.body.orders)).toBe(true);

    const artisansRes = await agent.get('/api/admin/artisans');
    expect(artisansRes.status).toBe(200);
    expect(Array.isArray(artisansRes.body.artisans)).toBe(true);
  });
});
