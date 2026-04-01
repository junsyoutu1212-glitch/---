import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 HTML 폴더 연결
app.use(express.static("public"));

const DB_FILE = "./db.json";

// DB 초기화
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    books: [],
    records: []
  }, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ================== API ==================

// 📚 책 목록
app.get("/books", (req, res) => {
  const db = readDB();
  res.json(db.books); // 🔥 배열 반환
});

// 📚 책 추가
app.post("/books", (req, res) => {
  const db = readDB();

  const book = {
    id: Date.now().toString(),
    ...req.body
  };

  db.books.push(book);
  writeDB(db);

  res.json({ ok: true, book });
});

// 📖 기록 조회
app.get("/records", (req, res) => {
  const db = readDB();
  res.json(db.records); // 🔥 배열 반환
});

// 📖 기록 저장
app.post("/records", (req, res) => {
  const db = readDB();

  db.records.push({
    id: Date.now().toString(),
    ...req.body
  });

  writeDB(db);

  res.json({ ok: true });
});

// 상태 체크
app.get("/api", (req, res) => {
  res.json({ ok: true, msg: "API running" });
});

// ================== 서버 실행 ==================

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
