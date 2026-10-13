const request = require('supertest');
const app = require('../../app');
const {
  Product,
  ProductVariant,
  User,
  Order,
  OrderItem,
  OrderTimeline,
  CartItem,
  Discount,
} = require('../../db/models');
const orderService = require('../../services/orderService');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let defaultSeller;

beforeAll(() => {
  if (!process.env.PAYMOB_HMAC_SECRET) {
    process.env.PAYMOB_HMAC_SECRET = 'test_paymob_hmac_secret_concurrency';
  }
});

beforeEach(async () => {
  defaultSeller = await User.create({
    name: 'Artisan Concurrency Studio',
    email: `seller-conc-${Date.now()}-${Math.random()}@shop.com`,
    password: await bcrypt.hash('Passw0rd!x', 4),
    role: 'seller',
  });
});

describe('Phase 5 Concurrency & ACID Acceptance Suite', () => {
  /**
   * Acceptance Criterion 1: Concurrency
   * 20 parallel checkouts against stock of 5 yield exactly 5 orders (HTTP 201)
   * and 15 conflict rejections (HTTP 409), with final stock exactly 0 (never negative).
   */
  it('prevents overselling under 20 concurrent checkouts for a product with stock 5', async () => {
    const product = await Product.create({
      title: 'Limited Edition Obsidian Dagger',
      price: 250,
      description: 'Hand-carved volcanic glass dagger',
      imageUrl: 'images/dagger.jpg',
      stock: 5,
      sellerId: defaultSeller.id,
      category: 'metals',
      isAvailable: true,
    });

    // Create 20 buyers and set 1 piece in each buyer's cart
    const buyers = [];
    for (let i = 0; i < 20; i++) {
      const buyer = await User.create({
        email: `conc-buyer-${i}-${Date.now()}@test.com`,
        password: await bcrypt.hash('Passw0rd!x', 4),
        role: 'customer',
      });
      await CartItem.create({
        userId: buyer.id,
        productId: product.id,
        quantity: 1,
      });
      buyers.push(buyer);
    }

    // Execute 20 simultaneous checkouts in parallel
    const results = await Promise.allSettled(
      buyers.map((buyer) =>
        orderService.createOrder(buyer, {
          paymentMethod: 'card',
          shippingAddress: { name: 'Patron', street: '1st Ave', city: 'Cairo', country: 'Egypt' },
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(15);

    // Verify all 15 rejections failed with HTTP 409 Conflict
    failed.forEach((f) => {
      expect(f.reason.status).toBe(409);
      expect(f.reason.message).toMatch(/out of stock/i);
    });

    // Verify product stock in DB is exactly 0 and never dropped below 0
    const updatedProduct = await Product.findByPk(product.id);
    expect(Number(updatedProduct.stock)).toBe(0);

    // Verify exactly 5 orders exist in the database
    const ordersCount = await Order.count();
    expect(ordersCount).toBe(5);
  });

  /**
   * Acceptance Criterion 2: Atomicity
   * Force a simulated failure during order item insertion inside the transaction.
   * Asserts that transaction rollbacks completely: zero inventory loss and no orphaned order.
   */
  it('rolls back stock decrement and deletes order draft if an error occurs mid-transaction', async () => {
    const product = await Product.create({
      title: 'Kohl Vessel in Brass',
      price: 80,
      description: 'Hand-hammered brass vessel',
      imageUrl: 'images/kohl.jpg',
      stock: 10,
      sellerId: defaultSeller.id,
      category: 'metals',
      isAvailable: true,
    });

    const buyer = await User.create({
      email: `atomic-buyer-${Date.now()}@test.com`,
      password: await bcrypt.hash('Passw0rd!x', 4),
      role: 'customer',
    });

    await CartItem.create({
      userId: buyer.id,
      productId: product.id,
      quantity: 2,
    });

    // Mock OrderItem.create to throw a database crash
    const spy = vi.spyOn(OrderItem, 'create').mockRejectedValueOnce(new Error('Simulated disk failure'));

    await expect(
      orderService.createOrder(buyer, {
        paymentMethod: 'card',
      })
    ).rejects.toThrow('Simulated disk failure');

    spy.mockRestore();

    // Verify stock is completely unchanged (still 10)
    const productAfter = await Product.findByPk(product.id);
    expect(Number(productAfter.stock)).toBe(10);

    // Verify no orders were created
    const ordersAfter = await Order.count();
    expect(ordersAfter).toBe(0);

    // Verify cart items were not deleted
    const cartCount = await CartItem.count({ where: { userId: buyer.id } });
    expect(cartCount).toBe(1);
  });

  /**
   * Acceptance Criterion 3: Payment Webhook Idempotency
   * Replaying the identical Paymob webhook twice results in only one order status update
   * and one stock decrement.
   */
  it('processes Paymob webhook idempotently without double-decrementing stock on duplicate delivery', async () => {
    const user = await User.create({
      email: `idemp-buyer-${Date.now()}@test.com`,
      password: await bcrypt.hash('Passw0rd!x', 4),
      role: 'customer',
    });

    const product = await Product.create({
      title: 'Hand-Carved Cedar Chest',
      price: 300,
      description: 'Aromatic cedar trunk',
      imageUrl: 'images/chest.jpg',
      stock: 8,
      sellerId: defaultSeller.id,
      category: 'other',
    });

    const order = await Order.create({
      userId: user.id,
      userEmail: user.email,
      userName: 'Sultan Al-Otaibi',
      subtotal: 600,
      totalPrice: 600,
      status: 'pending',
      paymentStatus: 'unpaid',
      shipName: 'Sultan',
      shipStreet: 'Tahlia St',
      shipCity: 'Riyadh',
      shipCountry: 'Saudi Arabia',
    });

    await OrderItem.create({
      orderId: order.id,
      productId: product.id,
      quantity: 2,
      productSnapshot: {
        _id: product.id,
        id: product.id,
        title: product.title,
        price: 300,
        sellerId: defaultSeller.id,
      },
    });

    const webhookPayload = {
      obj: {
        id: 99887766,
        success: true,
        order: {
          id: 554433,
          merchant_order_id: order.id.toString(),
        },
        amount_cents: 60000,
        currency: 'USD',
      },
    };

    // Calculate cryptographic HMAC
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
    const concatenated =
      webhookPayload.obj.amount_cents +
      '' +
      webhookPayload.obj.currency +
      '' +
      '' +
      webhookPayload.obj.id +
      '' +
      '' +
      '' +
      '' +
      '' +
      '' +
      '' +
      webhookPayload.obj.order.id +
      '' +
      '' +
      '' +
      '' +
      '' +
      webhookPayload.obj.success;
    const computedHmac = crypto.createHmac('sha512', hmacSecret).update(concatenated).digest('hex');

    // 1st Webhook delivery
    const res1 = await request(app)
      .post(`/api/paymob/webhook?hmac=${computedHmac}`)
      .send(webhookPayload);

    expect(res1.status).toBe(200);
    expect(res1.body.received).toBe(true);

    const orderAfterFirst = await Order.findByPk(order.id);
    expect(orderAfterFirst.paymentStatus).toBe('paid');
    expect(orderAfterFirst.status).toBe('confirmed');

    const productAfterFirst = await Product.findByPk(product.id);
    expect(Number(productAfterFirst.stock)).toBe(6); // 8 - 2

    // 2nd Duplicate Webhook delivery (network replay / retry)
    const res2 = await request(app)
      .post(`/api/paymob/webhook?hmac=${computedHmac}`)
      .send(webhookPayload);

    expect(res2.status).toBe(200);
    expect(res2.body.message).toMatch(/already fulfilled/i);

    // Stock must remain 6 (NEVER decremented to 4)
    const productAfterSecond = await Product.findByPk(product.id);
    expect(Number(productAfterSecond.stock)).toBe(6);

    // Timeline must contain only 1 confirmation record
    const timelineRecords = await OrderTimeline.findAll({ where: { orderId: order.id } });
    expect(timelineRecords).toHaveLength(1);
  });

  /**
   * Acceptance Criterion 4: Discount Voucher Limit Guard
   * A discount code with usage_limit = 1 used by two simultaneous checkouts allows
   * exactly 1 order with discount and rejects the second with 409 Conflict.
   */
  it('strictly enforces discount usage_limit = 1 under simultaneous checkout races', async () => {
    const discount = await Discount.create({
      code: 'VIPONEONLY',
      discountType: 'fixed',
      discountValue: 50,
      usageLimit: 1,
      usedCount: 0,
      isActive: true,
      minOrderAmount: 0,
    });

    const product = await Product.create({
      title: 'Hand-Hammered Copper Tray',
      price: 100,
      description: 'Traditional tin-lined copper serving tray',
      imageUrl: 'images/tray.jpg',
      stock: 10,
      sellerId: defaultSeller.id,
      category: 'metals',
    });

    const buyerA = await User.create({
      email: `buyer-a-${Date.now()}@test.com`,
      password: await bcrypt.hash('Passw0rd!x', 4),
      role: 'customer',
    });
    await CartItem.create({ userId: buyerA.id, productId: product.id, quantity: 1 });

    const buyerB = await User.create({
      email: `buyer-b-${Date.now()}@test.com`,
      password: await bcrypt.hash('Passw0rd!x', 4),
      role: 'customer',
    });
    await CartItem.create({ userId: buyerB.id, productId: product.id, quantity: 1 });

    // Race both checkouts simultaneously with the single-use voucher
    const results = await Promise.allSettled([
      orderService.createOrder(buyerA, { discountCode: 'VIPONEONLY' }),
      orderService.createOrder(buyerB, { discountCode: 'VIPONEONLY' }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    expect(failed[0].reason.status).toBe(409);
    expect(failed[0].reason.message).toMatch(/limit/i);

    // Verify in database that used_count never exceeded 1
    const updatedDiscount = await Discount.findByPk(discount.id);
    expect(Number(updatedDiscount.usedCount)).toBe(1);
  });
});
