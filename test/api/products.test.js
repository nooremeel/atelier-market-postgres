const request = require('supertest');
const crypto = require('crypto');
const app = require('../../app');
const { Product, User } = require('../../db/models');

let sellerUser;

beforeEach(async () => {
  sellerUser = await User.create({
    name: 'Artisan Seller',
    email: `seller-${Date.now()}-${Math.random()}@example.com`,
    password: 'hashedpassword123',
    role: 'seller',
  });
});

async function seed(n = 6) {
  const docs = [];
  for (let i = 1; i <= n; i++) {
    docs.push({
      title: i % 2 ? `Arabica Coffee ${i}` : `Green Tea ${i}`,
      price: i * 10,
      description: `Description for item ${i} with keyword special${i}`,
      imageUrl: `images/item-${i}.jpg`,
      sellerId: sellerUser.id,
      category: 'other',
    });
  }
  await Product.bulkCreate(docs);
}

describe('GET /api/products', () => {
  it('paginates with 6 per page', async () => {
    await seed(8);
    const res = await request(app).get('/api/products?page=1');
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(6);
    expect(res.body.pagination).toMatchObject({
      currentPage: 1, lastPage: 2, hasNextPage: true, hasPreviousPage: false, totalItems: 8,
    });
  });

  it('filters by q against title and description using full-text search', async () => {
    await seed(6);
    const res = await request(app).get('/api/products?q=special3');
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].description).toContain('special3');
  });

  it('ranks title matches higher than description matches (ts_rank weight A > C)', async () => {
    // Item 1: match in description (weight C)
    const itemDesc = await Product.create({
      title: 'Terracotta Planter',
      price: 45,
      description: 'Finely spun artisanal ceramic clay with smooth finish.',
      imageUrl: 'images/planter.jpg',
      sellerId: sellerUser.id,
      category: 'ceramics',
    });

    // Item 2: match in title (weight A)
    const itemTitle = await Product.create({
      title: 'Ceramic Serving Platter',
      price: 80,
      description: 'Handcrafted stoneware for dinner parties.',
      imageUrl: 'images/platter.jpg',
      sellerId: sellerUser.id,
      category: 'ceramics',
    });

    const res = await request(app).get('/api/products?q=ceramic');
    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThanOrEqual(2);

    // Title match must outrank description match
    expect(res.body.products[0].id).toBe(itemTitle.id);
    expect(res.body.products[1].id).toBe(itemDesc.id);
  });

  it('sorts by price_desc', async () => {
    await seed(4);
    const res = await request(app).get('/api/products?sort=price_desc');
    const prices = res.body.products.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('bounds by minPrice/maxPrice', async () => {
    await seed(6);
    const res = await request(app).get('/api/products?minPrice=20&maxPrice=40');
    expect(res.body.products.every((p) => p.price >= 20 && p.price <= 40)).toBe(true);
  });
});

describe('GET /api/products/:id', () => {
  it('returns one product', async () => {
    await seed(1);
    const one = await Product.findOne();
    const res = await request(app).get(`/api/products/${one._id}`);
    expect(res.status).toBe(200);
    expect(res.body.product._id).toBe(one._id.toString());
  });

  it('404s for a missing id', async () => {
    const missingId = crypto.randomUUID();
    const res = await request(app).get(`/api/products/${missingId}`);
    expect(res.status).toBe(404);
  });
});
