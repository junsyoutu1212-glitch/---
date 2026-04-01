import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const DB_FILE = "./db.json";

// =====================
// DB 초기화
// =====================
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    books: [],
    records: [],
    users: []
  }, null, 2));
}

// =====================
// DB 함수
// =====================
function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// =====================
// 로그 미들웨어
// =====================
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// =====================
// 기본 체크
// =====================
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Server running" });
});

// =====================
// 📚 BOOK API
// =====================

// 책 목록
app.get("/books", (req, res) => {
  const db = readDB();
  res.json(db.books);
});

// 책 추가
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

// 기록 조회
app.get("/records", (req, res) => {
  const db = readDB();
  res.json(db.records);
});

// 기록 저장
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
// 👤 USER / ROLE (관리자)
// =====================

// 사용자 등록 (자동 role 부여)
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
      role: "student" // 기본 학생
    };
    db.users.push(user);
    writeDB(db);
  }

  res.json({ ok: true, user });
});

// 🔥 관리자 지정 (핵심)
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
// 에러 처리
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
