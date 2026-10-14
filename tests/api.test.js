const request = require('supertest');
const app = require('../server');
const { pool } = require('../server');

let userId;

beforeAll(async () => {
  // Attendre que la table users existe
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      break;
    } catch (err) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Créer un utilisateur de départ
  const res = await request(app)
    .post('/api/users')
    .send({ name: 'Seed User', email: 'seed@example.com' });
  userId = res.body.id;
});

afterAll(async () => {
  await pool.end();
});

describe('REST API Tests', () => {
  describe('GET /api/users', () => {
    it('should return all users', async () => {
      const res = await request(app).get('/api/users');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBeTruthy();
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user', async () => {
      const newUser = {
        name: 'Test User',
        email: 'test@example.com'
      };
      const res = await request(app)
        .post('/api/users')
        .send(newUser);
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe(newUser.name);
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return a specific user', async () => {
      const res = await request(app).get(`/api/users/${userId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app).get('/api/users/9999999');
      expect(res.statusCode).toBe(404);
    });
  });
});