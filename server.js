// server.js
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

// Railway Postgres 연결
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

/* =========================
   🔥 추가 1: JSON 에러 강제 처리
========================= */
app.use((err, req, res, next) => {
  console.error("🔥 서버 에러:", err);
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "서버 내부 오류"
  });
});

/* =========================
   DB 초기화
========================= */
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

/* =========================
   유저 관련
========================= */
async function getUserFromRequest(req) {
  const email = req.headers["x-user-email"];
  if (!email) return null;
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

/* =========================
   🔥 추가 2: requireRole 개선
========================= */
function requireRole(roles) {
  return async (req, res, next) => {
    try {
      const user = await getUserFromRequest(req);

      if (!user) {
        return res.status(401).json({
          ok: false,
          error: "로그인이 필요합니다.",
          code: "NO_USER"
        });
      }

      if (!roles.includes(user.role)) {
        return res.status(403).json({
          ok: false,
          error: "권한이 없습니다.",
          code: "NO_PERMISSION"
        });
      }

      req.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/* =========================
   Google 로그인
========================= */
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID
  });
  return ticket.getPayload();
}

app.post("/auth/google", async (req, res) => {
  try {
    const payload = await verifyGoogleToken(req.body.credential);
    const { email, name, picture } = payload;

    let user = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

    if (user.rows.length === 0) {
      user = await pool.query(
        "INSERT INTO users (email,name,picture) VALUES ($1,$2,$3) RETURNING *",
        [email, name, picture]
      );
    } else {
      user = await pool.query(
        "UPDATE users SET name=$2,picture=$3 WHERE email=$1 RETURNING *",
        [email, name, picture]
      );
    }

    res.json({ ok: true, user: user.rows[0] });
  } catch (e) {
    res.status(401).json({ ok: false, error: "Google 인증 실패" });
  }
});

/* =========================
   Books API
========================= */
app.get("/api/books", async (req, res) => {
  const { class_name } = req.query;
  const q = class_name
    ? await pool.query("SELECT * FROM books WHERE class_name=$1", [class_name])
    : await pool.query("SELECT * FROM books");

  res.json({ ok: true, books: q.rows });
});

app.post("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  const { class_name, title, author, pages } = req.body;
  const result = await pool.query(
    "INSERT INTO books (class_name,title,author,pages,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [class_name, title, author, pages, req.user.id]
  );
  res.json({ ok: true, book: result.rows[0] });
});

/* =========================
   Records API
========================= */
app.get("/api/records", requireRole(["teacher", "admin"]), async (req, res) => {
  const { class_name } = req.query;

  const result = await pool.query(
    `
    SELECT r.*, b.title, u.name
    FROM reading_records r
    LEFT JOIN books b ON r.book_id = b.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.class_name = $1
  `,
    [class_name]
  );

  res.json({ ok: true, records: result.rows });
});

app.post("/api/records", requireRole(["student", "teacher", "admin"]), async (req, res) => {
  const { studentName, className, bookId, todayPages } = req.body;

  const prev = await pool.query(
    "SELECT MAX(total_pages) FROM reading_records WHERE user_id=$1 AND book_id=$2",
    [req.user.id, bookId]
  );

  const total = (prev.rows[0].max || 0) + todayPages;

  const result = await pool.query(
    "INSERT INTO reading_records (user_id,class_name,book_id,today_pages,total_pages,date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [req.user.id, className, bookId, todayPages, total, new Date()]
  );

  res.json({ ok: true, record: result.rows[0] });
});

/* =========================
   🔥 추가 3: 404 JSON 처리
========================= */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Not Found"
  });
});

/* =========================
   서버 실행
========================= */
initDb().then(() => {
  app.listen(PORT, () => {
    console.log("🚀 Server running on", PORT);
  });
});
