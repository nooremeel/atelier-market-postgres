/**
 * @file scripts/seed.js
 * @description Database seeder for PostgreSQL edition of Atelier Market.
 * Seeds personas (admin, sellers, customers), catalog products, variants,
 * reviews, addresses, and discount vouchers idempotently.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const {
  User,
  SellerProfile,
  Address,
  Product,
  ProductVariant,
  Review,
  Discount,
  sequelize,
} = db;

const SELLERS = [
  {
    name: 'Layla Al-Rashidi',
    email: 'layla@ateliermarket.com',
    role: 'seller',
    avatar: '',
    phone: '+973 17 000 001',
    profile: {
      shopName: 'Al-Rashidi Ceramics',
      shopDescription:
        'Third-generation ceramicist from the Gulf. Every piece is wheel-thrown by hand, glazed with local mineral pigments, and fired in a wood kiln.',
      city: 'Manama',
      country: 'Bahrain',
      lat: 26.2235,
      lng: 50.5876,
    },
  },
  {
    name: 'Omar Khalil',
    email: 'omar@ateliermarket.com',
    role: 'seller',
    avatar: '',
    phone: '+20 2 000 0002',
    profile: {
      shopName: 'Khalil Bindery',
      shopDescription:
        'Bookbinder and leather craftsman based in Cairo. Combining Islamic geometric ornamentation with Swiss binding techniques since 2011.',
      city: 'Cairo',
      country: 'Egypt',
      lat: 30.0444,
      lng: 31.2357,
    },
  },
  {
    name: 'Nour Mansour',
    email: 'nour@ateliermarket.com',
    role: 'seller',
    avatar: '',
    phone: '+961 1 000 003',
    profile: {
      shopName: 'Beit Al-Nour Glass',
      shopDescription:
        'Mouth-blown glassware workshop in the Levant tradition. Designs inspired by Damascene architecture and Ottoman-era apothecary vessels.',
      city: 'Beirut',
      country: 'Lebanon',
      lat: 33.8886,
      lng: 35.4955,
    },
  },
  {
    name: 'Tariq Al-Saud',
    email: 'tariq@ateliermarket.com',
    role: 'seller',
    avatar: '',
    phone: '+966 11 000 0004',
    profile: {
      shopName: 'Atelier Saud Metals',
      shopDescription:
        'Fine metalwork studio in Riyadh. Copper, brass, and bronze objects made using traditional Najdi repousse and chasing techniques.',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
    },
  },
];

const ADMIN = {
  name: 'Admin Director',
  email: 'admin@ateliermarket.com',
  role: 'admin',
  avatar: '',
  phone: '+971 4 000 0000',
};

const CUSTOMERS = [
  { name: 'Sara Hassan', email: 'sara@example.com', phone: '+971 50 111 2222' },
  { name: 'James Elliot', email: 'james@example.com', phone: '+44 20 7946 0991' },
  { name: 'Aisha Karimi', email: 'aisha@example.com', phone: '+965 22 333 444' },
];

async function seed() {
  console.log('[Seed] Starting PostgreSQL database seeding...');
  const hash = (pw) => bcrypt.hash(pw, 10);
  const defaultPw = await hash('Demo1234!');

  const userMap = {};

  // 1. Admin
  let admin = await User.findOne({ where: { email: ADMIN.email } });
  if (!admin) {
    admin = await User.create({
      ...ADMIN,
      password: defaultPw,
    });
    console.log(`[Seed] Created admin: ${admin.email}`);
  }
  userMap[admin.email] = admin;

  // 2. Sellers & Profiles
  for (const s of SELLERS) {
    let user = await User.findOne({ where: { email: s.email } });
    if (!user) {
      user = await User.create({
        name: s.name,
        email: s.email,
        password: defaultPw,
        role: s.role,
        avatar: s.avatar,
        phone: s.phone,
      });
      await SellerProfile.create({
        userId: user.id,
        shopName: s.profile.shopName,
        shopDescription: s.profile.shopDescription,
        city: s.profile.city,
        country: s.profile.country,
        lat: s.profile.lat,
        lng: s.profile.lng,
      });
      console.log(`[Seed] Created seller: ${user.email} (${s.profile.shopName})`);
    }
    userMap[user.email] = user;
  }

  // 3. Customers & Default Addresses
  for (const c of CUSTOMERS) {
    let user = await User.findOne({ where: { email: c.email } });
    if (!user) {
      user = await User.create({
        name: c.name,
        email: c.email,
        password: defaultPw,
        role: 'customer',
        phone: c.phone,
      });
      await Address.create({
        userId: user.id,
        label: 'Home',
        name: c.name,
        street: 'Al-Wasl Road, Villa 14B',
        city: 'Dubai',
        country: 'United Arab Emirates',
        postalCode: '00000',
        phone: c.phone,
        isDefault: true,
      });
      console.log(`[Seed] Created customer: ${user.email}`);
    }
    userMap[user.email] = user;
  }

  // 4. Products & Variants
  const layla = userMap['layla@ateliermarket.com'];
  const omar = userMap['omar@ateliermarket.com'];
  const nour = userMap['nour@ateliermarket.com'];
  const tariq = userMap['tariq@ateliermarket.com'];

  const productsData = [
    {
      sellerId: layla.id,
      title: 'Artisanal Ceramic Vessel',
      price: 185,
      compareAtPrice: null,
      description: 'Wheel-thrown stoneware featuring an organic matte chalk glaze. Sourced from the historic Mino province.',
      imageUrl: 'images/products/artisanal-ceramic-vessel.jpg',
      category: 'ceramics',
      badge: 'bestseller',
      tags: ['handmade', 'stoneware', 'glaze', 'vessel'],
      stock: 12,
      ratingAverage: 4.8,
      ratingCount: 34,
      city: 'Manama',
      country: 'Bahrain',
      lat: 26.2235,
      lng: 50.5876,
      variants: [
        { name: 'Standard Studio Edition', sku: 'ACV-STD', price: 185, stock: 8 },
        { name: 'Grand Exhibition Vessel', sku: 'ACV-GRD', price: 245, stock: 4 },
      ],
    },
    {
      sellerId: layla.id,
      title: 'Brushed Champagne Tea Set',
      price: 310,
      compareAtPrice: null,
      description: 'Hand-spun copper teapot with brushed tin interior and steam-bent walnut handle. Glazed in a soft dusty rose with gold leaf accents.',
      imageUrl: 'images/products/brushed-champagne-tea-set.jpg',
      category: 'ceramics',
      badge: 'limited',
      tags: ['tea', 'copper', 'handmade', 'luxury'],
      stock: 4,
      ratingAverage: 4.9,
      ratingCount: 11,
      city: 'Manama',
      country: 'Bahrain',
      lat: 26.2235,
      lng: 50.5876,
      variants: [],
    },
    {
      sellerId: layla.id,
      title: 'Wabi-Sabi Bowl — Rust & Ash',
      price: 95,
      compareAtPrice: 130,
      discountType: 'percentage',
      discountValue: 27,
      discountActive: true,
      description: 'A pinch-thrown bowl in iron-red with white ash drip glaze. Embraces the Japanese philosophy of beauty in imperfection.',
      imageUrl: 'images/products/wabi-sabi-bowl.jpg',
      category: 'ceramics',
      badge: 'sale',
      tags: ['bowl', 'wabi-sabi', 'rustic', 'iron red'],
      stock: 7,
      ratingAverage: 4.6,
      ratingCount: 18,
      city: 'Manama',
      country: 'Bahrain',
      lat: 26.2235,
      lng: 50.5876,
      variants: [],
    },
    {
      sellerId: omar.id,
      title: 'Monolithic Marble Bookends',
      price: 240,
      compareAtPrice: null,
      description: 'Pair of solid Nero Marquina marble blocks with hand-honed bevels and subtle natural veining.',
      imageUrl: 'images/products/monolithic-marble-bookends.jpg',
      category: 'books',
      badge: 'bestseller',
      tags: ['marble', 'bookends', 'minimalist', 'desk'],
      stock: 9,
      ratingAverage: 4.7,
      ratingCount: 22,
      city: 'Cairo',
      country: 'Egypt',
      lat: 30.0444,
      lng: 31.2357,
      variants: [],
    },
    {
      sellerId: omar.id,
      title: 'Architectural Leather Journal',
      price: 95,
      compareAtPrice: null,
      description: 'Full-grain vegetable-tanned bridle leather with Smyth-sewn archival cotton paper leaves. 200 pages, A5.',
      imageUrl: 'images/products/architectural-leather-journal.jpg',
      category: 'leather',
      badge: 'new',
      tags: ['journal', 'leather', 'handmade', 'stationery'],
      stock: 25,
      ratingAverage: 4.9,
      ratingCount: 41,
      city: 'Cairo',
      country: 'Egypt',
      lat: 30.0444,
      lng: 31.2357,
      variants: [
        { name: 'Desert Cognac / A5', sku: 'ALJ-COG-A5', price: 95, stock: 15 },
        { name: 'Obsidian Black / A5', sku: 'ALJ-BLK-A5', price: 95, stock: 10 },
      ],
    },
    {
      sellerId: nour.id,
      title: 'Obsidian Brew Carafe',
      price: 160,
      compareAtPrice: null,
      description: 'Borosilicate double-walled vessel paired with a spun brass filter sleeve for ceremonial extraction.',
      imageUrl: 'images/products/obsidian-brew-carafe.jpg',
      category: 'glass',
      badge: 'bestseller',
      tags: ['carafe', 'borosilicate', 'coffee', 'pour-over'],
      stock: 20,
      ratingAverage: 4.8,
      ratingCount: 57,
      city: 'Beirut',
      country: 'Lebanon',
      lat: 33.8886,
      lng: 35.4955,
      variants: [],
    },
    {
      sellerId: tariq.id,
      title: 'Najdi Repousse Tray',
      price: 380,
      compareAtPrice: null,
      description: 'Copper tray with hand-repousse geometric border inspired by Najdi door ornamentation. Tin-lined interior, silver-plated handle.',
      imageUrl: 'images/products/najdi-repousse-tray.jpg',
      category: 'metals',
      badge: 'limited',
      tags: ['copper', 'repousse', 'najdi', 'tray', 'traditional'],
      stock: 3,
      ratingAverage: 5.0,
      ratingCount: 7,
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
      variants: [],
    },
    {
      sellerId: tariq.id,
      title: 'Brass Incense Burner — Star Form',
      price: 195,
      compareAtPrice: null,
      description: 'Six-pointed star mabkhara in spun and chased brass. The pierced lid releases aromatic smoke in geometric patterns.',
      imageUrl: 'images/products/brass-incense-burner.jpg',
      category: 'metals',
      badge: 'bestseller',
      tags: ['incense', 'brass', 'mabkhara', 'oud', 'burner'],
      stock: 15,
      ratingAverage: 4.9,
      ratingCount: 44,
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
      variants: [],
    },
  ];

  let seededProducts = 0;
  for (const pData of productsData) {
    const { variants, ...prodFields } = pData;
    let prod = await Product.findOne({ where: { title: prodFields.title } });
    if (!prod) {
      prod = await Product.create(prodFields);
      if (variants && variants.length > 0) {
        for (const v of variants) {
          await ProductVariant.create({
            productId: prod.id,
            ...v,
          });
        }
      }
      seededProducts++;
    }
  }
  console.log(`[Seed] Seeded ${seededProducts} products and variants.`);

  // 5. Seed Discounts
  const discountsData = [
    {
      code: 'ATELIER10',
      description: 'Welcome 10% off storewide',
      discountType: 'percentage',
      discountValue: 10,
      minOrderAmount: 100,
      isActive: true,
    },
    {
      code: 'LUXURY50',
      description: '50 AED off orders above 300 AED',
      discountType: 'fixed',
      discountValue: 50,
      minOrderAmount: 300,
      isActive: true,
    },
  ];

  for (const d of discountsData) {
    const exists = await Discount.findOne({ where: { code: d.code } });
    if (!exists) {
      await Discount.create(d);
      console.log(`[Seed] Created discount: ${d.code}`);
    }
  }

  // 6. Seed Reviews
  const firstProduct = await Product.findOne({ where: { title: 'Artisanal Ceramic Vessel' } });
  const sara = userMap['sara@example.com'];
  if (firstProduct && sara) {
    const revExists = await Review.findOne({
      where: { productId: firstProduct.id, userId: sara.id },
    });
    if (!revExists) {
      await Review.create({
        productId: firstProduct.id,
        userId: sara.id,
        userName: sara.name,
        rating: 5,
        title: 'Exceptional craftsmanship',
        body: 'I was genuinely moved when I unwrapped this. The weight and texture are unlike anything from a mass-market store.',
        verified: true,
      });
      console.log('[Seed] Seeded verified customer review.');
    }
  }

  console.log('[Seed] Seeding completed successfully!');
}

if (require.main === module) {
  seed()
    .then(async () => {
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Seed] Seeding failed:', err);
      await sequelize.close();
      process.exit(1);
    });
}

module.exports = seed;
