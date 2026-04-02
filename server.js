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
    ? { rejectUnauthorized: false } // Railway/Heroku 스타일
    : false
});

if (!CLIENT_ID) {
  console.warn("⚠ GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.");
}
if (!process.env.DATABASE_URL) {
  console.warn("⚠ DATABASE_URL 환경 변수가 설정되지 않았습니다. DB 연결이 필요합니다.");
}

const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // public/index.html 제공

// DB 초기화 헬퍼 (간단 버전)
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

// Google ID 토큰 검증
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID
  });
  const payload = ticket.getPayload();
  return payload;
}

// 헬스 체크
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (e) {
    res.json({ ok: true, db: false, error: e.message });
  }
});

/**
 * 요청에서 현재 사용자 가져오기
 * - 프론트에서 x-user-email 헤더로 이메일을 보내는 방식
 */
async function getUserFromRequest(req) {
  const email = req.headers["x-user-email"];
  if (!email) return null;
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

/**
 * 역할 체크 미들웨어
 * 예: requireRole(["teacher", "admin"])
 */
function requireRole(roles) {
  return async (req, res, next) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ ok: false, error: "로그인이 필요합니다.(email 없음)" });
      }
      if (!roles.includes(user.role)) {
        return res.status(403).json({ ok: false, error: "권한이 없습니다." });
      }
      req.user = user;
      next();
    } catch (e) {
      console.error("requireRole error", e);
      res.status(500).json({ ok: false, error: "권한 확인 중 오류가 발생했습니다." });
    }
  };
}

// Google 로그인: 토큰 검증 + 사용자 정보/역할 DB 저장
app.post("/auth/google", async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ ok: false, error: "credential(ID 토큰)이 없습니다." });
  }

  try {
    const payload = await verifyGoogleToken(credential);

    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    if (!email) {
      return res
        .status(400)
        .json({ ok: false, error: "Google 계정 이메일 정보를 가져오지 못했습니다." });
    }

    // DB에서 사용자 조회
    const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    let userRow;
    if (existing.rows.length === 0) {
      // 없으면 student로 생성
      const insert = await pool.query(
        `
        INSERT INTO users (email, name, picture, role)
        VALUES ($1, $2, $3, 'student')
        RETURNING *
        `,
        [email, name, picture]
      );
      userRow = insert.rows[0];
    } else {
      // 있으면 이름/사진 업데이트 (역할은 유지)
      const update = await pool.query(
        `
        UPDATE users
        SET name = $2, picture = $3
        WHERE email = $1
        RETURNING *
        `,
        [email, name, picture]
      );
      userRow = update.rows[0];
    }

    res.json({
      ok: true,
      user: {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        picture: userRow.picture,
        role: userRow.role,
        class_name: userRow.class_name
      }
    });
  } catch (err) {
    console.error("Google ID 토큰 검증 실패:", err.message);
    res.status(401).json({ ok: false, error: "유효하지 않은 Google ID 토큰입니다." });
  }
});

// ---- 관리자용: 역할 변경 API (이메일 기준) ----
// (기존과 동일하지만 DB 사용)
app.post("/admin/set-role", async (req, res) => {
  const { email, role, secret, class_name } = req.body;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "관리자 비밀 코드가 올바르지 않습니다." });
  }
  if (!email) {
    return res.status(400).json({ ok: false, error: "email이 필요합니다." });
  }
  if (!["student", "teacher", "admin"].includes(role)) {
    return res
      .status(400)
      .json({ ok: false, error: "역할은 student | teacher | admin 중 하나여야 합니다." });
  }

  try {
    const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "해당 이메일 사용자가 없습니다. 먼저 Google 로그인으로 생성해 주세요." });
    }

    const update = await pool.query(
      `
      UPDATE users
      SET role = $2,
          class_name = COALESCE($3, class_name)
      WHERE email = $1
      RETURNING *
      `,
      [email, role, class_name || null]
    );

    const user = update.rows[0];

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
    console.error("/admin/set-role error", e);
    res.status(500).json({ ok: false, error: "역할 변경 중 오류가 발생했습니다." });
  }
});

// ---- 관리자용: 전체 사용자/역할 조회 ----
app.get("/admin/users", async (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "관리자 비밀 코드가 올바르지 않습니다." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, picture, role, class_name FROM users ORDER BY id ASC"
    );
    res.json({ ok: true, users: rows });
  } catch (e) {
    console.error("/admin/users error", e);
    res.status(500).json({ ok: false, error: "사용자 목록 조회 중 오류가 발생했습니다." });
  }
});

// ---- 책 API ----

// 책 목록 조회 (옵션: class_name 필터)
app.get("/api/books", async (req, res) => {
  try {
    const { class_name } = req.query;
    let result;
    if (class_name) {
      result = await pool.query(
        "SELECT * FROM books WHERE class_name = $1 ORDER BY id ASC",
        [class_name]
      );
    } else {
      result = await pool.query("SELECT * FROM books ORDER BY id ASC");
    }
    res.json({ ok: true, books: result.rows });
  } catch (e) {
    console.error("GET /api/books error", e);
    res.status(500).json({ ok: false, error: "도서 목록 조회 중 오류가 발생했습니다." });
  }
});

// 책 등록 (교사/관리자만)
app.post("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user; // requireRole에서 세팅
    const { class_name, title, author, pages } = req.body;

    if (!class_name || !title || !pages) {
      return res.status(400).json({ ok: false, error: "class_name, title, pages는 필수입니다." });
    }

    const insert = await pool.query(
      `
      INSERT INTO books (class_name, title, author, pages, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [class_name, title, author || null, pages, user.id]
    );

    res.json({ ok: true, book: insert.rows[0] });
  } catch (e) {
    console.error("POST /api/books error", e);
    res.status(500).json({ ok: false, error: "도서 등록 중 오류가 발생했습니다." });
  }
});

// ---- 읽기 기록 API ----

// 기록 조회 (class_name 필터 필수로 하는 걸 추천)
// 예: /api/records?class_name=4-2
app.get("/api/records", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { class_name } = req.query;
    if (!class_name) {
      return res.status(400).json({ ok: false, error: "class_name 쿼리 파라미터가 필요합니다." });
    }

    const result = await pool.query(
      `
      SELECT r.*, b.title AS book_title, b.pages AS book_pages, u.name AS user_name
      FROM reading_records r
      LEFT JOIN books b ON r.book_id = b.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.class_name = $1
      ORDER BY r.date ASC, r.id ASC
      `,
      [class_name]
    );

    res.json({ ok: true, records: result.rows });
  } catch (e) {
    console.error("GET /api/records error", e);
    res.status(500).json({ ok: false, error: "기록 조회 중 오류가 발생했습니다." });
  }
});

// 학생 기록 저장 (학생/교사/관리자 모두 허용)
app.post("/api/records", requireRole(["student", "teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const {
      studentName,
      className,
      bookId,
      todayPages,
      lastPage,
      targetPages
    } = req.body;

    if (!studentName || !className || !bookId || !todayPages) {
      return res.status(400).json({
        ok: false,
        error: "studentName, className, bookId, todayPages는 필수입니다."
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    // 동일 학생/반/책의 최댓값 total_pages 구해서 누적
    const key = `${studentName}|${className}|${bookId}`;
    const prev = await pool.query(
      `
      SELECT MAX(total_pages) AS max_total
      FROM reading_records
      WHERE class_name = $1
        AND book_id = $2
        AND user_id = $3
      `,
      [className, bookId, user.id]
    );
    const maxTotal = prev.rows[0].max_total || 0;
    const totalPages = maxTotal + Number(todayPages);

    const insert = await pool.query(
      `
      INSERT INTO reading_records (
        user_id, class_name, book_id,
        today_pages, total_pages,
        last_page, target_pages,
        date
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        user.id,
        className,
        bookId,
        todayPages,
        totalPages,
        lastPage || null,
        targetPages || null,
        todayStr
      ]
    );

    res.json({ ok: true, record: insert.rows[0] });
  } catch (e) {
    console.error("POST /api/records error", e);
    res.status(500).json({ ok: false, error: "기록 저장 중 오류가 발생했습니다." });
  }
});

// 기록 수정 (교사/관리자만)
app.patch("/api/records/:id", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const id = req.params.id;
    const {
      today_pages,
      total_pages,
      last_page,
      target_pages
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (today_pages != null) {
      fields.push(`today_pages = $${idx++}`);
      values.push(today_pages);
    }
    if (total_pages != null) {
      fields.push(`total_pages = $${idx++}`);
      values.push(total_pages);
    }
    if (last_page != null) {
      fields.push(`last_page = $${idx++}`);
      values.push(last_page);
    }
    if (target_pages != null) {
      fields.push(`target_pages = $${idx++}`);
      values.push(target_pages);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "수정할 필드가 없습니다." });
    }

    values.push(id);

    const query = `
      UPDATE reading_records
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "해당 기록을 찾을 수 없습니다." });
    }

    res.json({ ok: true, record: result.rows[0] });
  } catch (e) {
    console.error("PATCH /api/records/:id error", e);
    res.status(500).json({ ok: false, error: "기록 수정 중 오류가 발생했습니다." });
  }
});

// 기록 삭제 (교사/관리자만)
app.delete("/api/records/:id", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query(
      "DELETE FROM reading_records WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "해당 기록을 찾을 수 없습니다." });
    }
    res.json({ ok: true, id });
  } catch (e) {
    console.error("DELETE /api/records/:id error", e);
    res.status(500).json({ ok: false, error: "기록 삭제 중 오류가 발생했습니다." });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("DB 초기화 실패:", err);
    process.exit(1);
  });
