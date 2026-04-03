// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const cookieParser = require("cookie-parser");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const port = process.env.PORT || 3000;

// ===== PostgreSQL 연결 =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway, Render 등에서 SSL 필요 시:
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// ===== Google OAuth 설정 (리디렉션 방식) =====
const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI; 
// 예: https://your-domain.com/auth/google/callback

const oauthClient = new OAuth2Client(
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI
);

// ===== 미들웨어 =====
app.use(express.json());
app.use(cookieParser());

// 정적 파일 서빙 (index.html 포함)
app.use(express.static(path.join(__dirname, "public")));

// ===== 간단 세션용 쿠키 처리 =====
// 쿠키에 userId만 넣고, 실제 정보는 DB에서 조회
async function getUserFromRequest(req) {
  const userId = req.cookies["user_id"];
  if (!userId) return null;

  const { rows } = await pool.query(
    "SELECT id, email, name, picture, role, class_name FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] || null;
}

// role 체크 미들웨어
function requireRole(roles) {
  return async (req, res, next) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
      }
      if (!roles.includes(user.role)) {
        return res.status(403).json({ ok: false, error: "권한이 부족합니다." });
      }
      req.user = user;
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  };
}

// ===== Google OAuth: 로그인 시작 (리디렉션) =====
app.get("/auth/google/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account"
  });
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
  res.redirect(url);
});

// ===== Google OAuth: 콜백 =====
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("code 없음");

  try {
    // 1) code -> tokens
    const { tokens } = await oauthClient.getToken({
      code,
      redirect_uri: OAUTH_REDIRECT_URI
    });

    const idToken = tokens.id_token;
    if (!idToken) throw new Error("id_token 없음");

    // 2) id_token 검증 (이메일, 이름 등 추출)
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: OAUTH_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name || "";
    const picture = payload.picture || "";

    if (!email) {
      return res.status(400).send("이메일 정보 없음");
    }

    // 3) users 테이블 upsert
    const { rows } = await pool.query(
      `
      INSERT INTO users (email, name, picture, role, class_name)
      VALUES ($1, $2, $3, 'student', NULL)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        picture = EXCLUDED.picture
      RETURNING id, email, name, picture, role, class_name
      `,
      [email, name, picture]
    );

    const user = rows[0];

    // 4) user_id 쿠키에 저장
    res.cookie("user_id", user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    // 5) 메인 페이지로 리디렉션
    res.redirect("/");
  } catch (e) {
    console.error("Google OAuth 에러:", e);
    res.status(500).send("Google 로그인 처리 중 오류");
  }
});

// ===== 로그아웃 =====
app.post("/auth/logout", (req, res) => {
  res.clearCookie("user_id");
  res.json({ ok: true });
});

// ===== 현재 로그인 사용자 정보 =====
app.get("/auth/me", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.json({ ok: false, user: null });
    }
    res.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 관리자: 역할 설정 (예: 교사로 바꾸기) =====
app.post("/admin/set-role", async (req, res) => {
  const { email, role, class_name, secret } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "비밀키 불일치" });
  }
  if (!email || !role) {
    return res.status(400).json({ ok: false, error: "email, role은 필수" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET role = $2, class_name = $3
      WHERE email = $1
      RETURNING id, email, name, picture, role, class_name
      `,
      [email, role, class_name || null]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "사용자 없음" });
    }

    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 도서 API (교사 전용) =====

// 도서 목록 조회 (해당 교사/학급 기준)
app.get("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const className = user.class_name;

    const { rows } = await pool.query(
      "SELECT id, class_name, title, author, pages FROM books WHERE class_name = $1 ORDER BY id ASC",
      [className]
    );

    res.json({ ok: true, books: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// 도서 추가 (교사 전용)
app.post("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  const { className, title, author, pages } = req.body;

  if (!className || !title || !pages) {
    return res.status(400).json({ ok: false, error: "반, 제목, 전체 쪽수는 필수" });
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO books (class_name, title, author, pages)
      VALUES ($1, $2, $3, $4)
      RETURNING id, class_name, title, author, pages
      `,
      [className, title, author || "", pages]
    );

    res.json({ ok: true, book: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 학생 기록 API =====

// 학생 기록 추가 (학생/교사/관리자)
app.post("/api/records", requireRole(["student", "teacher", "admin"]), async (req, res) => {
  const { studentName, className, bookId, todayPages, lastPage, targetPages } = req.body;

  if (!studentName || !className || !bookId || !todayPages) {
    return res.status(400).json({ ok: false, error: "필수 항목 누락" });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    // 기존 누적값 조회
    const prev = await pool.query(
      `
      SELECT MAX(total_pages) AS max_total
      FROM records
      WHERE student_name = $1 AND class_name = $2 AND book_id = $3
      `,
      [studentName, className, bookId]
    );

    const maxTotal = prev.rows[0].max_total || 0;
    const newTotal = Number(maxTotal) + Number(todayPages);

    const { rows } = await pool.query(
      `
      INSERT INTO records
        (student_name, class_name, book_id, today_pages, total_pages, last_page, target_pages, date)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        studentName,
        className,
        bookId,
        todayPages,
        newTotal,
        lastPage || 0,
        targetPages || 0,
        todayStr
      ]
    );

    res.json({ ok: true, id: rows[0].id, totalPages: newTotal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// 기록 목록 조회 (교사/관리자만, 해당 학급)
app.get("/api/records", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const className = user.class_name;

    const { rows } = await pool.query(
      `
      SELECT
        r.id,
        r.student_name,
        r.class_name,
        r.book_id,
        r.today_pages,
        r.total_pages,
        r.last_page,
        r.target_pages,
        r.date,
        b.title AS book_title,
        b.pages AS book_pages
      FROM records r
      JOIN books b ON r.book_id = b.id
      WHERE r.class_name = $1
      ORDER BY r.id ASC
      `,
      [className]
    );

    res.json({ ok: true, records: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 서버 시작 =====
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
