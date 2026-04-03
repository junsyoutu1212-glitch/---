import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import pkg from "pg";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = "468945736758-5qec11vjns3jhta8sm6v936bp5nv39p0.apps.googleusercontent.com";
const ADMIN_SECRET = "CLASSROOM-SECRET";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      class_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      class_name TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      pages INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reading_records (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      class_name TEXT NOT NULL,
      book_id INTEGER REFERENCES books(id),
      today_pages INTEGER NOT NULL,
      total_pages INTEGER NOT NULL,
      last_page INTEGER,
      target_pages INTEGER,
      date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ DB 테이블 초기화 완료");
}

async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID
  });
  return ticket.getPayload();
}

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (e) {
    res.json({ ok: true, db: false });
  }
});

async function getUserFromRequest(req) {
  const email = req.headers["x-user-email"];
  if (!email) return null;
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

function requireRole(roles) {
  return async (req, res, next) => {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false });
    if (!roles.includes(user.role)) return res.status(403).json({ ok: false });
    req.user = user;
    next();
  };
}

/* ===================== 🔥 추가된 핵심 API ===================== */
// 현재 로그인 사용자 최신 정보 가져오기
app.get("/me", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "로그인 필요" });
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        class_name: user.class_name
      }
    });
  } catch (e) {
    console.error("/me error", e);
    res.status(500).json({ ok: false });
  }
});
/* ========================================================== */

app.post("/auth/google", async (req, res) => {
  const { credential } = req.body;
  const payload = await verifyGoogleToken(credential);

  const email = payload.email;
  const name = payload.name;
  const picture = payload.picture;

  const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

  let userRow;
  if (existing.rows.length === 0) {
    const insert = await pool.query(
      `INSERT INTO users (email, name, picture, role)
       VALUES ($1, $2, $3, 'student') RETURNING *`,
      [email, name, picture]
    );
    userRow = insert.rows[0];
  } else {
    const update = await pool.query(
      `UPDATE users SET name=$2, picture=$3 WHERE email=$1 RETURNING *`,
      [email, name, picture]
    );
    userRow = update.rows[0];
  }

  res.json({ ok: true, user: userRow });
});

app.post("/admin/set-role", async (req, res) => {
  const { email, role, secret } = req.body;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ ok: false });

  const result = await pool.query(
    `UPDATE users SET role=$2 WHERE email=$1 RETURNING *`,
    [email, role]
  );

  res.json({ ok: true, user: result.rows[0] });
});

initDb().then(() => {
  app.listen(PORT, () => console.log("Server running"));
});
