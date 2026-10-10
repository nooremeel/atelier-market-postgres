const request = require('supertest');
const app = require('../../app');
const { Product, Review, Order, OrderItem, User } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function login(agent, email = 'reviewer@example.com', role = 'customer') {
  const password = 'Passw0rd!x';
  const user = await User.create({
    name: 'Test Reviewer',
    email,
    password: await bcrypt.hash(password, 4),
    role,
  });
  const { body } = await agent.get('/api/csrf-token');
  await agent.post('/api/auth/login').set('csrf-token', body.csrfToken).send({ email, password });
  return user;
}

describe('Reviews API', () => {
  let product;
  let sellerUser;

  beforeEach(async () => {
    sellerUser = await User.create({
      name: 'Seller User',
      email: `seller-${Date.now()}-${Math.random()}@example.com`,
      password: 'hashedpassword123',
      role: 'seller',
    });
    product = await Product.create({
      title: 'Damascus Lantern',
      price: 150,
      description: 'Hand-pierced brass lantern.',
      imageUrl: 'images/lantern.jpg',
      sellerId: sellerUser.id,
      category: 'metals',
      ratingAverage: 0,
      ratingCount: 0,
    });
  });

  it('GET returns empty reviews list with initialized stats and distribution', async () => {
    const res = await request(app).get(`/api/products/${product.id}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(0);
    expect(res.body.stats).toEqual({
      average: 0,
      total: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    expect(res.body.userHasReviewed).toBe(false);
    expect(res.body.isVerifiedPurchaser).toBe(false);
  });

  it('POST rejects unauthenticated users with 401', async () => {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
    const res = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send({ rating: 5, title: 'Incredible', body: 'This is an outstanding piece of craftsmanship!' });
    expect(res.status).toBe(401);
  });

  it('POST validates rating, title, and body length', async () => {
    const agent = request.agent(app);
    await login(agent, 'user1@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    // Body too short (min 10)
    const res = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send({ rating: 5, title: 'Nice', body: 'Short' });
    expect(res.status).toBe(422);
  });

  it('POST creates review, marks verified purchase if order exists, and updates product ratings', async () => {
    const agent = request.agent(app);
    const user = await login(agent, 'buyer@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    // Create a paid order for this user containing this product
    const order = await Order.create({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      totalPrice: 150,
      status: 'delivered',
      paymentStatus: 'paid',
    });
    await OrderItem.create({
      orderId: order.id,
      productId: product.id,
      quantity: 1,
      productSnapshot: product.toJSON(),
    });

    const res = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send({
        rating: 5,
        title: 'Masterpiece of metalwork',
        body: 'The detail on the brass is astonishing. Arrived in pristine condition.',
      });

    expect(res.status).toBe(201);
    expect(res.body.review).toBeDefined();
    expect(res.body.review.verified).toBe(true);
    expect(res.body.review.rating).toBe(5);
    expect(res.body.review.userName).toBe('Test Reviewer');
    expect(res.body.review.userId.name).toBe('Test Reviewer');

    // Verify product ratings updated
    const updatedProduct = await Product.findById(product.id);
    expect(updatedProduct.ratings.average).toBe(5);
    expect(updatedProduct.ratings.count).toBe(1);

    // GET should now return stats with 5-star count = 1
    const getRes = await agent.get(`/api/products/${product.id}/reviews`);
    expect(getRes.body.reviews).toHaveLength(1);
    expect(getRes.body.stats.average).toBe(5);
    expect(getRes.body.stats.total).toBe(1);
    expect(getRes.body.stats.distribution[5]).toBe(1);
    expect(getRes.body.userHasReviewed).toBe(true);
    expect(getRes.body.isVerifiedPurchaser).toBe(true);
  });

  it('POST blocks duplicate reviews from the same user with 409', async () => {
    const agent = request.agent(app);
    await login(agent, 'repeat@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    const payload = {
      rating: 4,
      title: 'Very happy with this',
      body: 'Quiet elegance and beautiful texture throughout.',
    };

    const first = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send(payload);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already reviewed/i);
  });

  it('DELETE allows owner to delete review and recalculates product ratings', async () => {
    const agent = request.agent(app);
    await login(agent, 'owner@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    const postRes = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', csrf)
      .send({
        rating: 4,
        title: 'Lovely addition to the studio',
        body: 'Warm glow through the pierced patterns, very calming.',
      });
    const reviewId = postRes.body.review.id || postRes.body.review._id;

    // Delete review
    const delRes = await agent.delete(`/api/reviews/${reviewId}`).set('csrf-token', csrf);
    expect(delRes.status).toBe(200);

    // Verify product ratings reset
    const updatedProduct = await Product.findById(product.id);
    expect(updatedProduct.ratings.average).toBe(0);
    expect(updatedProduct.ratings.count).toBe(0);
  });

  it('POST accepts custom reviewer name, saves to review and syncs user name', async () => {
    const agent = request.agent(app);
    const password = 'Passw0rd!x';
    const email = 'nameless@example.com';
    const user = await User.create({
      name: '',
      email,
      password: await bcrypt.hash(password, 4),
      role: 'customer',
    });
    const { body } = await agent.get('/api/csrf-token');
    await agent.post('/api/auth/login').set('csrf-token', body.csrfToken).send({ email, password });

    const postRes = await agent
      .post(`/api/products/${product.id}/reviews`)
      .set('csrf-token', body.csrfToken)
      .send({
        rating: 5,
        title: 'Custom Name Review',
        body: 'Crafted with peerless precision and timeless balance.',
        name: 'Layla Al-Mansoor',
      });
    expect(postRes.status).toBe(201);
    expect(postRes.body.review.userName).toBe('Layla Al-Mansoor');

    // Confirm user's profile was updated with the name
    const updatedUser = await User.findById(user.id);
    expect(updatedUser.name).toBe('Layla Al-Mansoor');
  });
});
