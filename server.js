import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 환경 변수
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!CLIENT_ID) {
  console.warn("⚠ GOOGLE_CLIENT_ID 없음 (.env 확인)");
}

// 🔐 Google 인증
const client = new OAuth2Client(CLIENT_ID);

// 📦 SQLite 연결
const db = await open({
  filename: "./database.db",
  driver: sqlite3.Database
});

// 📄 테이블 생성
await db.exec(`
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  role TEXT DEFAULT 'student'
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  className TEXT,
  title TEXT,
  author TEXT,
  pages INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studentName TEXT,
  className TEXT,
  bookId INTEGER,
  todayPages INTEGER,
  totalPages INTEGER,
  lastPage INTEGER,
  targetPages INTEGER,
  date TEXT
);
`);

console.log("✅ SQLite 준비 완료");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* =========================
   🔐 Google 토큰 검증
========================= */
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID
  });
  return ticket.getPayload();
}

/* =========================
   ❤️ 헬스 체크
========================= */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   🔑 Google 로그인
========================= */
app.post("/auth/google", async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ ok: false, error: "credential 없음" });
  }

  try {
    const payload = await verifyGoogleToken(credential);

    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    let user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

    if (!user) {
      await db.run(
        "INSERT INTO users (email, name, picture, role) VALUES (?, ?, ?, ?)",
        [email, name, picture, "student"]
      );
      user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    } else {
      await db.run(
        "UPDATE users SET name = ?, picture = ? WHERE email = ?",
        [name, picture, email]
      );
      user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    }

    res.json({ ok: true, user });

  } catch (err) {
    console.error(err);
    res.status(401).json({ ok: false, error: "Google 인증 실패" });
  }
});

/* =========================
   🔐 관리자: 역할 변경
========================= */
app.post("/admin/set-role", async (req, res) => {
  const { email, role, secret } = req.body;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "권한 없음" });
  }

  if (!["student", "teacher", "admin"].includes(role)) {
    return res.status(400).json({ ok: false, error: "role 오류" });
  }

  await db.run(
    "UPDATE users SET role = ? WHERE email = ?",
    [role, email]
  );

  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

  res.json({ ok: true, user });
});

/* =========================
   👥 관리자: 전체 유저 조회
========================= */
app.get("/admin/users", async (req, res) => {
  const { secret } = req.query;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false });
  }

  const users = await db.all("SELECT * FROM users");

  res.json({ ok: true, users });
});

/* =========================
   📚 도서 API
========================= */

// 도서 추가
app.post("/books", async (req, res) => {
  const { className, title, author, pages } = req.body;

  if (!className || !title || !pages) {
    return res.status(400).json({ ok: false, error: "필수값 누락" });
  }

  const result = await db.run(
    "INSERT INTO books (className, title, author, pages) VALUES (?, ?, ?, ?)",
    [className, title, author || "", pages]
  );

  const book = await db.get("SELECT * FROM books WHERE id = ?", [result.lastID]);

  res.json({ ok: true, book });
});

// 도서 목록
app.get("/books", async (req, res) => {
  const books = await db.all("SELECT * FROM books ORDER BY createdAt DESC");
  res.json({ ok: true, books });
});

/* =========================
   📊 기록 API
========================= */

// 기록 저장
app.post("/records", async (req, res) => {
  const data = req.body;

  if (!data.studentName || !data.className || !data.bookId) {
    return res.status(400).json({ ok: false, error: "필수값 누락" });
  }

  const existing = await db.get(
    `SELECT * FROM records 
     WHERE studentName = ? AND className = ? AND bookId = ? AND date = ?`,
    [data.studentName, data.className, data.bookId, data.date]
  );

  if (existing) {
    await db.run(
      `UPDATE records 
       SET todayPages = todayPages + ?, totalPages = totalPages + ?
       WHERE id = ?`,
      [data.todayPages, data.todayPages, existing.id]
    );

    const updated = await db.get("SELECT * FROM records WHERE id = ?", [existing.id]);
    return res.json({ ok: true, record: updated });
  }

  const result = await db.run(
    `INSERT INTO records 
     (studentName, className, bookId, todayPages, totalPages, lastPage, targetPages, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.studentName,
      data.className,
      data.bookId,
      data.todayPages,
      data.totalPages,
      data.lastPage || 0,
      data.targetPages || 0,
      data.date
    ]
  );

  const record = await db.get("SELECT * FROM records WHERE id = ?", [result.lastID]);

  res.json({ ok: true, record });
});

// 기록 조회
app.get("/records", async (req, res) => {
  const records = await db.all("SELECT * FROM records");
  res.json({ ok: true, records });
});

//삭제
app.delete("/records/:id", async (req,res)=>{
  await db.run("DELETE FROM records WHERE id=?", [req.params.id]);
  res.json({ok:true});
});

/* =========================
   🚀 서버 시작
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
