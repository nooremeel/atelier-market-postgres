const request = require('supertest');
const app = require('../../app');
const { User } = require('../../db/models');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const createdFiles = [];

async function loginUser(email = 'uploader@atelier.sa', role = 'customer') {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role,
    name: 'Image Uploader',
  });
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

afterAll(() => {
  // Clean up any test files created in the images folder
  createdFiles.forEach((f) => {
    try {
      const fullPath = path.join(__dirname, '../..', f.replace(/^\/+/, ''));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // ignore cleanup errors
    }
  });
});

describe('Image Upload API', () => {
  it('POST /api/upload returns 401 when unauthenticated', async () => {
    const anonAgent = request.agent(app);
    const csrf = (await anonAgent.get('/api/csrf-token')).body.csrfToken;
    const res = await anonAgent.post('/api/upload').set('csrf-token', csrf);
    expect(res.status).toBe(401);
  });

  it('POST /api/upload returns 422 when no file is attached', async () => {
    const { agent, csrf } = await loginUser('nofile@atelier.sa');
    const res = await agent.post('/api/upload').set('csrf-token', csrf);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no valid image file/i);
  });

  it('POST /api/upload successfully uploads a PNG and returns imageUrl', async () => {
    const { agent, csrf } = await loginUser('pnguser@atelier.sa');
    const dummyPngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

    const res = await agent
      .post('/api/upload')
      .set('csrf-token', csrf)
      .attach('image', dummyPngBuffer, 'test-portrait.png');

    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toBeDefined();
    expect(res.body.imageUrl).toMatch(/^\/images\/.*test-portrait\.png$/);

    createdFiles.push(res.body.imageUrl);
  });

  it('POST /api/upload supports webp images', async () => {
    const { agent, csrf } = await loginUser('webpuser@atelier.sa');
    const dummyWebpBuffer = Buffer.from('RIFF20000000WEBPVP8X0a0000000000000000000000', 'utf8');

    const res = await agent
      .post('/api/upload')
      .set('csrf-token', csrf)
      .attach('image', dummyWebpBuffer, { filename: 'artwork.webp', contentType: 'image/webp' });

    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toMatch(/^\/images\/.*artwork\.webp$/);

    createdFiles.push(res.body.imageUrl);
  });

  it('PATCH /api/account/profile supports direct multipart image upload for avatar', async () => {
    const { agent, csrf, user } = await loginUser('avatarupload@atelier.sa');
    const dummyPngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

    const res = await agent
      .patch('/api/account/profile')
      .set('csrf-token', csrf)
      .field('name', 'Nour Al-Atelier')
      .attach('image', dummyPngBuffer, 'my-avatar.png');

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Nour Al-Atelier');
    expect(res.body.user.avatar).toMatch(/^\/images\/.*my-avatar\.png$/);

    createdFiles.push(res.body.user.avatar);

    const updatedUser = await User.findByPk(user.id || user._id);
    expect(updatedUser.avatar).toMatch(/^\/images\/.*my-avatar\.png$/);
  });
});
