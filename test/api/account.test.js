const request = require('supertest');
const app = require('../../app');
const { User } = require('../../db/models');
const bcrypt = require('bcryptjs');

async function createAgent(email, role = 'customer') {
  const agent = request.agent(app);
  const password = 'Passw0rd!x';
  const user = await User.create({
    email,
    password: await bcrypt.hash(password, 4),
    role,
    name: email.split('@')[0],
    phone: '+966500000000',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    cart: { items: [] },
    addresses: [],
  });
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken;
  await agent.post('/api/auth/login').set('csrf-token', csrf).send({ email, password });
  return { agent, csrf, user };
}

describe('Customer Account API', () => {
  describe('Authentication guards', () => {
    it('returns 401 on GET when unauthenticated', async () => {
      expect((await request(app).get('/api/account/profile')).status).toBe(401);
      expect((await request(app).get('/api/account/addresses')).status).toBe(401);
    });

    it('returns 401 on mutating endpoints with valid csrf when unauthenticated', async () => {
      const anonAgent = request.agent(app);
      const csrf = (await anonAgent.get('/api/csrf-token')).body.csrfToken;
      expect((await anonAgent.patch('/api/account/profile').set('csrf-token', csrf).send({ name: 'Hacker' })).status).toBe(401);
      expect((await anonAgent.post('/api/account/addresses').set('csrf-token', csrf).send({ street: '1' })).status).toBe(401);
    });
  });

  describe('Profile Endpoints', () => {
    it('returns user profile including empty addresses list', async () => {
      const { agent, user } = await createAgent('patron1@shop.com');
      const res = await agent.get('/api/account/profile');
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('patron1@shop.com');
      expect(res.body.user.name).toBe('patron1');
      expect(res.body.user.addresses).toEqual([]);
    });

    it('updates user profile details (name, phone, avatar)', async () => {
      const { agent, csrf } = await createAgent('patron2@shop.com');
      const res = await agent.patch('/api/account/profile').set('csrf-token', csrf).send({
        name: 'Fatima Al-Mansoor',
        phone: '+966555123456',
        avatar: 'https://images.unsplash.com/photo-custom?w=200',
      });
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Fatima Al-Mansoor');
      expect(res.body.user.phone).toBe('+966555123456');
      expect(res.body.user.avatar).toBe('https://images.unsplash.com/photo-custom?w=200');

      // Verify persistence
      const fresh = await agent.get('/api/account/profile');
      expect(fresh.body.user.name).toBe('Fatima Al-Mansoor');
    });
  });

  describe('Address Book CRUD', () => {
    it('validates required fields on address creation', async () => {
      const { agent, csrf } = await createAgent('patron3@shop.com');
      const res = await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        street: '',
        city: '',
        country: '',
      });
      expect(res.status).toBe(422);
      expect(res.body.errorMessage).toBeDefined();
    });

    it('creates first address and automatically sets it as default and syncs user.address', async () => {
      const { agent, csrf } = await createAgent('patron4@shop.com');
      const res = await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Home',
        name: 'Nour Atelier',
        street: '12 Al-Diriyah St',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        postalCode: '12345',
        phone: '+966501112233',
      });
      expect(res.status).toBe(201);
      expect(res.body.address).toBeDefined();
      expect(res.body.address.isDefault).toBe(true);
      expect(res.body.address.city).toBe('Riyadh');
      expect(res.body.addresses.length).toBe(1);

      // Verify sync with profile
      const prof = await agent.get('/api/account/profile');
      expect(prof.body.user.address.street).toBe('12 Al-Diriyah St');
      expect(prof.body.user.address.city).toBe('Riyadh');
      expect(prof.body.user.addresses.length).toBe(1);
      expect(prof.body.user.addresses[0].isDefault).toBe(true);
    });

    it('adds a second address with isDefault=true and updates previous default', async () => {
      const { agent, csrf } = await createAgent('patron5@shop.com');
      const addr1 = await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Home',
        street: '10 Olaya Towers',
        city: 'Riyadh',
        country: 'Saudi Arabia',
      });
      expect(addr1.status).toBe(201);

      const addr2 = await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Studio',
        name: 'Nour Studio',
        street: '45 Corniche Rd',
        city: 'Jeddah',
        country: 'Saudi Arabia',
        postalCode: '21452',
        isDefault: true,
      });
      expect(addr2.status).toBe(201);
      expect(addr2.body.address.isDefault).toBe(true);
      expect(addr2.body.addresses.length).toBe(2);

      const list = await agent.get('/api/account/addresses');
      expect(list.body.addresses.length).toBe(2);
      const home = list.body.addresses.find(a => a.label === 'Home');
      const studio = list.body.addresses.find(a => a.label === 'Studio');
      expect(home.isDefault).toBe(false);
      expect(studio.isDefault).toBe(true);

      // Verify profile syncs to new default
      const prof = await agent.get('/api/account/profile');
      expect(prof.body.user.address.street).toBe('45 Corniche Rd');
      expect(prof.body.user.address.city).toBe('Jeddah');
    });

    it('updates an existing address and can reassign default status', async () => {
      const { agent, csrf } = await createAgent('patron6@shop.com');
      const addr1 = (await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Apartment',
        street: '5 King Fahd Rd',
        city: 'Khobar',
        country: 'Saudi Arabia',
      })).body.address;

      const addr2 = (await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Office',
        street: '22 Business Gate',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        isDefault: true,
      })).body.address;

      // Update addr1 to be default and change street
      const patchRes = await agent.patch(`/api/account/addresses/${addr1._id}`).set('csrf-token', csrf).send({
        street: '7 King Fahd Rd',
        isDefault: true,
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.address.street).toBe('7 King Fahd Rd');
      expect(patchRes.body.address.isDefault).toBe(true);

      const list = await agent.get('/api/account/addresses');
      const updatedAddr1 = list.body.addresses.find(a => a._id === addr1._id);
      const updatedAddr2 = list.body.addresses.find(a => a._id === addr2._id);
      expect(updatedAddr1.isDefault).toBe(true);
      expect(updatedAddr2.isDefault).toBe(false);

      // Profile updated to addr1
      const prof = await agent.get('/api/account/profile');
      expect(prof.body.user.address.street).toBe('7 King Fahd Rd');
      expect(prof.body.user.address.city).toBe('Khobar');
    });

    it('deletes an address and promotes the remaining address to default if needed', async () => {
      const { agent, csrf } = await createAgent('patron7@shop.com');
      const addr1 = (await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Primary',
        street: '1st Street',
        city: 'Dammam',
        country: 'Saudi Arabia',
      })).body.address;

      const addr2 = (await agent.post('/api/account/addresses').set('csrf-token', csrf).send({
        label: 'Secondary',
        street: '2nd Street',
        city: 'Dammam',
        country: 'Saudi Arabia',
        isDefault: false,
      })).body.address;

      // Delete the default address (addr1)
      const delRes = await agent.delete(`/api/account/addresses/${addr1._id}`).set('csrf-token', csrf);
      expect(delRes.status).toBe(200);
      expect(delRes.body.addresses.length).toBe(1);
      // addr2 should now be promoted to default
      expect(delRes.body.addresses[0]._id).toBe(addr2._id);
      expect(delRes.body.addresses[0].isDefault).toBe(true);

      // Verify sync with profile
      const prof = await agent.get('/api/account/profile');
      expect(prof.body.user.address.street).toBe('2nd Street');

      // Now delete the only remaining address
      const delFinal = await agent.delete(`/api/account/addresses/${addr2._id}`).set('csrf-token', csrf);
      expect(delFinal.status).toBe(200);
      expect(delFinal.body.addresses.length).toBe(0);

      const emptyProf = await agent.get('/api/account/profile');
      expect(emptyProf.body.user.address.street).toBe('');
    });
  });
});
