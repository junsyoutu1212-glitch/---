import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// 기본 설정
// =====================
app.use(cors());
app.use(express.json());

// 정적 파일 (HTML)
app.use(express.static("public"));

// =====================
// DB 설정
// =====================
const DB_FILE = "./db.json";

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    books: [],
    records: [],
    users: []
  }, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// =====================
// 로그
// =====================
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// =====================
// 📄 HTML 루트
// =====================
app.get("/", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// =====================
// 📚 BOOK API
// =====================

// 전체 조회
app.get("/books", (req, res) => {
  const db = readDB();
  res.json(db.books);
});

// 추가
app.post("/books", (req, res) => {
  const { title, className, pages, author } = req.body;

  if (!title || !className || !pages) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  const db = readDB();

  const newBook = {
    id: Date.now().toString(),
    title,
    className,
    pages: Number(pages),
    author: author || "",
    createdAt: new Date().toISOString()
  };

  db.books.push(newBook);
  writeDB(db);

  res.json({ ok: true, book: newBook });
});

// =====================
// 📊 RECORD API
// =====================

// 조회
app.get("/records", (req, res) => {
  const db = readDB();
  res.json(db.records);
});

// 저장
app.post("/records", (req, res) => {
  const {
    studentName,
    className,
    bookId,
    todayPages,
    totalPages
  } = req.body;

  if (!studentName || !className || !bookId) {
    return res.status(400).json({ ok: false, error: "필수값 없음" });
  }

  const db = readDB();

  const newRecord = {
    id: Date.now().toString(),
    studentName,
    className,
    bookId,
    todayPages: Number(todayPages) || 0,
    totalPages: Number(totalPages) || 0,
    createdAt: new Date().toISOString()
  };

  db.records.push(newRecord);
  writeDB(db);

  res.json({ ok: true, record: newRecord });
});

// =====================
// 👤 USER / 관리자
// =====================

// 유저 생성 or 조회
app.post("/users", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ ok: false });
  }

  const db = readDB();

  let user = db.users.find(u => u.email === email);

  if (!user) {
    user = {
      email,
      role: "student"
    };
    db.users.push(user);
    writeDB(db);
  }

  res.json({ ok: true, user });
});

// 관리자 지정
app.post("/admin", (req, res) => {
  const { email } = req.body;

  const db = readDB();
  const user = db.users.find(u => u.email === email);

  if (!user) {
    return res.status(404).json({ ok: false, error: "유저 없음" });
  }

  user.role = "admin";
  writeDB(db);

  res.json({ ok: true, user });
});

// =====================
// ❌ 404 처리
// =====================
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found" });
});

// =====================
// 실행
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
