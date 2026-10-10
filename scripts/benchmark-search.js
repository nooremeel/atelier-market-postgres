/**
 * @file scripts/benchmark-search.js
 * @description Benchmark script for PostgreSQL full-text search with GIN index.
 * Seeds ~3,000 products to build realistic catalog volume, runs ANALYZE,
 * and executes EXPLAIN (ANALYZE, BUFFERS) to verify GIN index performance.
 */

require('dotenv').config();
const { sequelize, Product, User } = require('../db');

async function benchmark() {
  console.log('Connecting to database...');
  await sequelize.authenticate();

  let seller = await User.findOne({ where: { role: 'seller' } });
  if (!seller) {
    seller = await User.create({
      name: 'Benchmark Artisan',
      email: 'benchmark-artisan@example.com',
      password: 'password123',
      role: 'seller',
    });
  }

  const currentCount = await Product.count();
  console.log(`Current products count: ${currentCount}`);

  const TARGET_COUNT = 3000;
  if (currentCount < TARGET_COUNT) {
    const toCreate = TARGET_COUNT - currentCount;
    console.log(`Generating ${toCreate} synthetic artisanal products for benchmark...`);

    const materials = ['Ceramic', 'Leather', 'Terracotta', 'Brass', 'Glass', 'Silk', 'Linen', 'Wool', 'Copper', 'Olive Wood'];
    const items = ['Bowl', 'Vase', 'Lantern', 'Journal', 'Rug', 'Teapot', 'Platter', 'Sculpture', 'Tote', 'Coaster'];
    const regions = ['Damascus', 'Cairo', 'Fez', 'Isfahan', 'Tunis', 'Aleppo', 'Hebron', 'Manama', 'Muscat', 'Amman'];
    const styles = ['handcrafted', 'artisanal', 'wheel-thrown', 'hand-embroidered', 'pierced metal', 'vegetable-tanned', 'glazed', 'carved'];

    const batchSize = 500;
    for (let batch = 0; batch < toCreate; batch += batchSize) {
      const records = [];
      const currentBatch = Math.min(batchSize, toCreate - batch);

      for (let i = 0; i < currentBatch; i++) {
        const idNum = currentCount + batch + i;
        const mat = materials[idNum % materials.length];
        const item = items[(idNum * 3) % items.length];
        const reg = regions[(idNum * 7) % regions.length];
        const sty = styles[(idNum * 5) % styles.length];

        records.push({
          sellerId: seller.id,
          title: `${reg} ${mat} ${item} #${idNum}`,
          description: `Finely crafted ${sty} ${item.toLowerCase()} made from authentic ${mat.toLowerCase()} by master artisans in ${reg}.`,
          imageUrl: `images/item-${(idNum % 20) + 1}.jpg`,
          price: (25 + (idNum % 250)).toFixed(2),
          category: mat === 'Ceramic' || mat === 'Terracotta' ? 'ceramics'
            : mat === 'Leather' ? 'leather'
            : mat === 'Glass' ? 'glass'
            : mat === 'Brass' || mat === 'Copper' ? 'metals'
            : mat === 'Silk' || mat === 'Linen' || mat === 'Wool' ? 'textiles'
            : 'other',
          tags: [mat.toLowerCase(), item.toLowerCase(), reg.toLowerCase(), sty],
          stock: 25,
          ratingAverage: ((idNum % 5) + 1).toFixed(2),
          ratingCount: (idNum % 50),
        });
      }

      await Product.bulkCreate(records);
      process.stdout.write(`Inserted batch ${(batch / batchSize) + 1}/${Math.ceil(toCreate / batchSize)}\r`);
    }
    console.log(`\nSuccessfully seeded database to ${await Product.count()} products.`);
  }

  console.log('Running VACUUM ANALYZE products to update PostgreSQL optimizer statistics...');
  await sequelize.query('VACUUM ANALYZE products;');

  const searchQuery = 'ceramic bowl';
  console.log(`\nRunning EXPLAIN (ANALYZE, BUFFERS) for websearch_to_tsquery('english', '${searchQuery}')...\n`);

  const explainSql = `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT p.id, p.title, p.price, p.category, ts_rank(p.search_vector, q) AS rank
    FROM products p, websearch_to_tsquery('english', :query) q
    WHERE p.search_vector @@ q
    ORDER BY rank DESC, p.created_at DESC
    LIMIT 12 OFFSET 0;
  `;

  const [results] = await sequelize.query(explainSql, {
    replacements: { query: searchQuery },
  });

  const planLines = results.map(r => r['QUERY PLAN']).join('\n');
  console.log('=== EXECUTION PLAN ===');
  console.log(planLines);
  console.log('======================');

  await sequelize.close();
}

benchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
