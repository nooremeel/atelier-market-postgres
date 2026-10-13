const adminService = require('../../services/adminService');
const productService = require('../../services/productService');
const { User, Product, Order, OrderItem, SellerProfile } = require('../../db/models');
const bcrypt = require('bcryptjs');

describe('adminService & productService admin methods', () => {
  let sellerUser, customerUser, adminUser;

  beforeEach(async () => {
    sellerUser = await User.create({
      name: 'Artisan Samira',
      email: `samira-${Date.now()}-${Math.random()}@ateliermarket.com`,
      password: await bcrypt.hash('Demo1234!', 4),
      role: 'seller',
    });
    await SellerProfile.create({
      userId: sellerUser.id,
      shopName: 'Samira Glazes',
      city: 'Tunis',
      country: 'Tunisia',
    });
    await sellerUser.reload({ include: [{ model: SellerProfile, as: 'sellerProfile' }] });

    customerUser = await User.create({
      name: 'Buyer Karim',
      email: `karim-${Date.now()}-${Math.random()}@example.com`,
      password: await bcrypt.hash('Demo1234!', 4),
      role: 'customer',
    });

    adminUser = await User.create({
      name: 'Director Nadia',
      email: `nadia-${Date.now()}-${Math.random()}@ateliermarket.com`,
      password: await bcrypt.hash('Demo1234!', 4),
      role: 'admin',
    });
  });

  describe('adminService.getPlatformStats', () => {
    it('aggregates revenue, orders, products, and ranks top artisans', async () => {
      const product = await Product.create({
        title: 'Tunisian Terracotta Vase',
        price: 120,
        description: 'Hand-thrown terracotta vase',
        imageUrl: 'images/vase.jpg',
        sellerId: sellerUser.id,
        category: 'ceramics',
        stock: 10,
      });

      const order = await Order.create({
        userId: customerUser.id,
        userEmail: customerUser.email,
        userName: customerUser.name,
        subtotal: 240,
        totalPrice: 240,
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
          price: 120,
          sellerId: sellerUser.id,
        },
      });

      const { stats, recentOrders, topArtisans } = await adminService.getPlatformStats();

      expect(stats.totalRevenue).toBe(240);
      expect(stats.totalOrders).toBe(1);
      expect(stats.totalProducts).toBe(1);
      expect(stats.totalArtisans).toBe(1);
      expect(stats.totalCustomers).toBe(1);
      expect(recentOrders).toHaveLength(1);
      expect(recentOrders[0].totalPrice).toBe(240);
      expect(topArtisans).toHaveLength(1);
      expect(topArtisans[0].shopName).toBe('Samira Glazes');
      expect(topArtisans[0].grossSales).toBe(240);
      expect(topArtisans[0].productCount).toBe(1);
    });
  });

  describe('adminService.getAllOrders & getArtisansDirectory', () => {
    it('returns orders and artisan directory with piece counts', async () => {
      await Product.create({
        title: 'Glazed Plate',
        price: 50,
        description: 'Small ceramic plate',
        imageUrl: 'images/plate.jpg',
        sellerId: sellerUser.id,
        category: 'ceramics',
      });

      const orders = await adminService.getAllOrders();
      expect(Array.isArray(orders)).toBe(true);

      const artisans = await adminService.getArtisansDirectory();
      expect(artisans).toHaveLength(1);
      expect(artisans[0].email).toBe(sellerUser.email);
      expect(artisans[0].productCount).toBe(1);
    });
  });

  describe('productService admin methods', () => {
    it('creates, inspects, updates, discounts, and deletes products with authorization', async () => {
      // 1. Create product
      const created = await productService.createProduct(
        sellerUser,
        {
          title: 'Handmade Mug',
          price: '35',
          description: 'Ceramic coffee mug',
          stock: '15',
          lowStockThreshold: '3',
        },
        'images/mug.jpg'
      );
      expect(created._id).toBeDefined();
      expect(created.title).toBe('Handmade Mug');
      expect(created.price).toBe(35);
      expect(created.stock).toBe(15);
      expect(created.artisan.shopName).toBe('Samira Glazes');

      // 2. Inspect product as owner
      const inspected = await productService.getAdminProductById(created._id, sellerUser);
      expect(inspected.title).toBe('Handmade Mug');

      // 3. Reject inspection from unauthorized user
      const otherUser = await User.create({
        name: 'Other Seller',
        email: `other-${Date.now()}@shop.com`,
        password: await bcrypt.hash('hash', 4),
        role: 'seller',
      });
      await expect(productService.getAdminProductById(created._id, otherUser)).rejects.toThrow('Not authorized');

      // 4. Update product
      const updated = await productService.updateProduct(
        created._id,
        sellerUser,
        {
          title: 'Handmade Mug V2',
          price: '40',
          description: 'Updated mug description',
          stock: '20',
          isAvailable: true,
        }
      );
      expect(updated.title).toBe('Handmade Mug V2');
      expect(updated.price).toBe(40);
      expect(updated.stock).toBe(20);

      // 5. Apply percentage discount
      const discounted = await productService.applyProductDiscount(
        created._id,
        sellerUser,
        { type: 'percentage', value: 20 }
      );
      expect(discounted.badge).toBe('sale');
      expect(discounted.price).toBe(32); // 40 - 20%
      expect(discounted.compareAtPrice).toBe(40);

      // 6. Remove discount
      const restored = await productService.removeProductDiscount(created._id, sellerUser);
      expect(restored.badge).toBe('');
      expect(restored.price).toBe(40);
      expect(restored.compareAtPrice).toBeNull();

      // 7. Delete product
      await productService.deleteProductById(created._id, sellerUser);
      const afterDelete = await Product.findByPk(created._id);
      expect(afterDelete).toBeNull();
    });
  });
});
