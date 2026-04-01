import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_FILE = "./db.json";

// ===== 초기 DB =====
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    books: [],
    records: []
  }, null, 2));
}

// ===== DB 함수 =====
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch (err) {
    console.error("DB 읽기 실패:", err);
    return { books: [], records: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("DB 저장 실패:", err);
  }
}

// ===== 유틸 =====
function isValidNumber(n) {
  return typeof n === "number" && !isNaN(n);
}

// ===== 로그 미들웨어 =====
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// =========================
// 📚 책 목록 조회
// =========================
app.get("/books", (req, res) => {
  const db = readDB();
  res.json(db.books);
});

// =========================
// 📚 책 추가
// =========================
app.post("/books", (req, res) => {
  const { className, title, author, pages } = req.body;

  if (!className || !title || !isValidNumber(pages)) {
    return res.status(400).json({
      ok: false,
      error: "필수값 누락"
    });
  }

  const db = readDB();

  const newBook = {
    id: "book_" + Date.now(),
    className,
    title,
    author: author || "",
    pages
  };

  db.books.push(newBook);
  writeDB(db);

  res.json({
    ok: true,
    book: newBook
  });
});

// =========================
// 📚 책 삭제 (교사용)
// =========================
app.delete("/books/:id", (req, res) => {
  const { id } = req.params;
  const db = readDB();

  db.books = db.books.filter(b => b.id !== id);
  writeDB(db);

  res.json({ ok: true });
});

// =========================
// 📖 기록 조회
// =========================
app.get("/records", (req, res) => {
  const db = readDB();
  res.json(db.records);
});

// =========================
// 📖 기록 저장
// =========================
app.post("/records", (req, res) => {
  const { studentName, className, bookId, todayPages } = req.body;

  if (!studentName || !className || !bookId || !isValidNumber(todayPages)) {
    return res.status(400).json({
      ok: false,
      error: "입력값 오류"
    });
  }

  const db = readDB();

  const key = `${studentName}|${className}|${bookId}`;

  const prev = db.records.filter(r => r.key === key);
  let totalPages = todayPages;

  if (prev.length > 0) {
    const max = Math.max(...prev.map(p => p.totalPages));
    totalPages = max + todayPages;
  }

  const record = {
    key,
    studentName,
    className,
    bookId,
    todayPages,
    totalPages,
    date: new Date().toISOString()
  };

  db.records.push(record);
  writeDB(db);

  res.json({
    ok: true,
    record
  });
});

// =========================
// 📖 기록 삭제
// =========================
app.delete("/records", (req, res) => {
  const db = readDB();
  db.records = [];
  writeDB(db);

  res.json({ ok: true });
});

// =========================
// 📊 상태 체크
// =========================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

// =========================
// 기본
// =========================
app.get("/", (req, res) => {
  res.send("Reading Dashboard API Running");
});

// =========================
// 서버 실행
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
