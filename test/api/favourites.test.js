const request = require('supertest');
const app = require('../../app');
const { Product, User, Favourite } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function login(agent, email = 'favtest@example.com') {
  const password = 'Passw0rd!x';
  const user = await User.create({
    name: 'Fav Tester',
    email,
    password: await bcrypt.hash(password, 4),
    role: 'customer',
  });
  const { body } = await agent.get('/api/csrf-token');
  await agent.post('/api/auth/login').set('csrf-token', body.csrfToken).send({ email, password });
  return user;
}

describe('Favourites API', () => {
  let product;
  let seller;

  beforeEach(async () => {
    seller = await User.create({
      name: 'Glass Artisan',
      email: `glass-seller-${Date.now()}-${Math.random()}@example.com`,
      password: 'Passw0rd!x',
      role: 'seller',
    });
    product = await Product.create({
      title: 'Damascus Window Lantern',
      price: 220,
      description: 'Geometric star-pattern lantern in hand-blown cobalt glass.',
      imageUrl: 'images/lantern.jpg',
      sellerId: seller.id,
      category: 'glass',
    });
  });

  it('rapid concurrent POST /api/favourites does not create duplicate entries', async () => {
    const agent = request.agent(app);
    const user = await login(agent, 'rapid@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    // Simulate 2 rapid concurrent clicks
    await Promise.all([
      agent.post('/api/favourites').set('csrf-token', csrf).send({ productId: product.id.toString() }),
      agent.post('/api/favourites').set('csrf-token', csrf).send({ productId: product.id.toString() }),
    ]);

    // Check database directly
    const matchingFavs = await Favourite.findAll({
      where: { userId: user.id, productId: product.id },
    });

    // Can never have more than 1 occurrence due to composite primary key
    expect(matchingFavs.length).toBeLessThanOrEqual(1);

    // Verify GET /api/favourites has no duplicates
    const getRes = await agent.get('/api/favourites');
    expect(getRes.status).toBe(200);
    const getMatching = getRes.body.favourites.filter(
      (p) => (p._id || p.id).toString() === product.id.toString()
    );
    expect(getMatching.length).toBeLessThanOrEqual(1);
  });

  it('toggling on and off works deterministically', async () => {
    const agent = request.agent(app);
    await login(agent, 'toggle@example.com');
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;

    // Add
    let res = await agent.post('/api/favourites').set('csrf-token', csrf).send({ productId: product.id.toString() });
    expect(res.body.favourited).toBe(true);

    let getRes = await agent.get('/api/favourites');
    expect(getRes.body.favourites).toHaveLength(1);

    // Remove
    res = await agent.post('/api/favourites').set('csrf-token', csrf).send({ productId: product.id.toString() });
    expect(res.body.favourited).toBe(false);

    getRes = await agent.get('/api/favourites');
    expect(getRes.body.favourites).toHaveLength(0);
  });
});
