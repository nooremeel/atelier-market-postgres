# Improvement Plan & Bug Log — Atelier Market (PostgreSQL Edition)

This file tracks production bug fixes, test discrepancies, architectural enhancements, and technical debt per the project developer contract.

---

## Bug Log

### [2026-10-17] Bug: Agent Busy-Wait Polling Loop on Asynchronous Background Tasks
- **Symptom**: During long-running tasks (such as the 3-minute 173-test React client suite), the agent repeatedly polled `manage_task(Action: 'status')` in a tight loop across dozens of turns rather than yielding control.
- **Root cause**: Explicit status polling violates the IDE's reactive wakeup mechanism. When background commands execute, the system dispatches high-priority completion messages automatically; polling status creates artificial loop cycles.
- **Fix**: Codified strict prohibition against polling `manage_task(Action: 'status')`. When a command launches in the background, execution stops immediately and awaits the event-driven completion notification.
- **Files**: IDE workflow policy
- **Tags**: ide, workflow, task-management

### [2026-10-17] Bug: Sequelize DECIMAL String Coercion Mismatch
- **Symptom**: `AssertionError: expected '80.00' to be 80` and `expected '150.00' to be 150` in `test/api/discount.test.js`.
- **Root cause**: Sequelize `DataTypes.DECIMAL(12, 2)` returns database numeric columns as string literals by default to preserve extreme arbitrary precision in JavaScript. However, the existing domain logic and test contracts expect native numbers.
- **Fix**: Added explicit `get()` getters to `price`, `compareAtPrice`, `subtotal`, `totalPrice`, `discountValue`, `discountAmount`, `ratingAverage`, etc. on `Product`, `Order`, `Discount`, and `ProductVariant` models to return clean JavaScript numbers.
- **Files**: `db/models/Product.js`, `db/models/Order.js`, `db/models/Discount.js`, `db/models/ProductVariant.js`
- **Tags**: sequelize, postgres, types, testing

### [2026-10-17] Bug: Mongoose Model Buffering Timeout in discountController
- **Symptom**: `MongooseError: Operation discounts.findOne() buffering timed out after 10000ms` when hitting `/api/discounts/validate`.
- **Root cause**: `controllers/discountController.js` was still importing the legacy Mongoose model from `../models/discount` instead of Sequelize `db/models`.
- **Fix**: Ported `controllers/discountController.js` to Sequelize with `Discount.findOne({ where: { code } })`, `findAll`, `create`, `save`, `destroy`.
- **Files**: `controllers/discountController.js`
- **Tags**: mongoose, sequelize, discounts
