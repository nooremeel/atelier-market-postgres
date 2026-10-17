const request = require('supertest');
const app = require('../../app');

describe('meta endpoints', () => {
  it('GET /api/csrf-token returns a token', async () => {
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(10);
  });

  it('GET /api/auth/me is 401 when logged out', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
  });

  it('GET /api/health returns 200 and healthy database status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.timestamp).toBeDefined();
  });
});
