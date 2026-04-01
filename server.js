import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID = "468945736758-5qec11vjns3jhta8sm6v936bp5nv39p0.apps.googleusercontent.com";
const JWT_SECRET = "SUPER_SECRET_KEY"; // 바꿔라
const ADMIN_SECRET = "CLASSROOM-SECRET";

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// DB 생성
const db = new Database("database.db");

// 테이블 생성
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  role TEXT DEFAULT 'student'
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT,
  author TEXT,
  pages INTEGER,
  className TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studentName TEXT,
  className TEXT,
  bookId TEXT,
  todayPages INTEGER,
  totalPages INTEGER,
  date TEXT
)
`).run();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ---------------- JWT 미들웨어 ---------------- */
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "토큰 오류" });
  }
}

/* ---------------- Google 로그인 ---------------- */
app.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);

    if (!user) {
      db.prepare(`
        INSERT INTO users (email, name, picture, role)
        VALUES (?, ?, ?, 'student')
      `).run(email, name, picture);
    } else {
      db.prepare(`
        UPDATE users SET name=?, picture=? WHERE email=?
      `).run(name, picture, email);
    }

    user = db.prepare("SELECT * FROM users WHERE email=?").get(email);

    const token = jwt.sign(
      { email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(401).json({ ok: false, error: "로그인 실패" });
  }
});

/* ---------------- 역할 변경 (관리자) ---------------- */
app.post("/admin/set-role", (req, res) => {
  const { email, role, secret } = req.body;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "권한 없음" });
  }

  db.prepare("UPDATE users SET role=? WHERE email=?").run(role, email);

  res.json({ ok: true });
});

/* ---------------- 도서 ---------------- */

// 도서 추가 (교사만)
app.post("/books", authMiddleware, (req, res) => {
  if (req.user.role !== "teacher" && req.user.role !== "admin") {
    return res.status(403).json({ error: "교사만 가능" });
  }

  const { title, author, pages, className } = req.body;
  const id = "book_" + Date.now();

  db.prepare(`
    INSERT INTO books (id, title, author, pages, className)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title, author, pages, className);

  res.json({ ok: true });
});

// 도서 목록
app.get("/books", (req, res) => {
  const books = db.prepare("SELECT * FROM books").all();
  res.json(books);
});

/* ---------------- 기록 ---------------- */

// 기록 추가
app.post("/records", authMiddleware, (req, res) => {
  const { studentName, className, bookId, todayPages } = req.body;

  const prev = db.prepare(`
    SELECT MAX(totalPages) as max FROM records
    WHERE studentName=? AND className=? AND bookId=?
  `).get(studentName, className, bookId);

  const total = (prev?.max || 0) + todayPages;

  db.prepare(`
    INSERT INTO records (studentName, className, bookId, todayPages, totalPages, date)
    VALUES (?, ?, ?, ?, ?, DATE('now'))
  `).run(studentName, className, bookId, todayPages, total);

  res.json({ ok: true });
});

// 기록 조회
app.get("/records", (req, res) => {
  const records = db.prepare("SELECT * FROM records").all();
  res.json(records);
});

// 기록 삭제 (교사만)
app.delete("/records/:id", authMiddleware, (req, res) => {
  if (req.user.role !== "teacher" && req.user.role !== "admin") {
    return res.status(403).json({ error: "교사만 삭제 가능" });
  }

  db.prepare("DELETE FROM records WHERE id=?").run(req.params.id);

  res.json({ ok: true });
});

/* ---------------- 서버 시작 ---------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
