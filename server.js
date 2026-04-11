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
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// ===== Google OAuth 설정 (리디렉션) =====
const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

const oauthClient = new OAuth2Client(
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI
);

// ===== 미들웨어 =====
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ===== 유저 조회 (쿠키 + x-user-email 둘 다 허용) =====
async function getUserFromRequest(req) {
  const userId = req.cookies["user_id"];
  const headerEmail = req.headers["x-user-email"];

  if (userId) {
    const { rows } = await pool.query(
      "SELECT id, email, name, picture, role, class_name FROM users WHERE id = $1",
      [userId]
    );
    if (rows[0]) return rows[0];
  }

  if (headerEmail) {
    const { rows } = await pool.query(
      "SELECT id, email, name, picture, role, class_name FROM users WHERE email = $1",
      [headerEmail]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

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

// ===== Google OAuth: 로그인 시작 =====
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
    const { tokens } = await oauthClient.getToken({
      code,
      redirect_uri: OAUTH_REDIRECT_URI
    });

    const idToken = tokens.id_token;
    if (!idToken) throw new Error("id_token 없음");

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

    res.cookie("user_id", user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.redirect("/");
  } catch (e) {
    console.error("Google OAuth 에러:", e);
    res.status(500).send("Google 로그인 처리 중 오류");
  }
});

// ===== 인증 관련 API =====
app.post("/auth/logout", (req, res) => {
  res.clearCookie("user_id");
  res.json({ ok: true });
});

app.get("/auth/me", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.json({ ok: false, user: null });
    res.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 교사용 반 설정/수정 API =====
app.post("/teacher/set-class", requireRole(["teacher", "admin"]), async (req, res) => {
  const { class_name } = req.body;
  if (!class_name || !class_name.trim()) {
    return res.status(400).json({ ok: false, error: "반 이름은 비어 있을 수 없습니다." });
  }

  try {
    const user = req.user;
    const { rows } = await pool.query(
      `
      UPDATE users
      SET class_name = $2
      WHERE id = $1
      RETURNING id, email, name, picture, role, class_name
      `,
      [user.id, class_name.trim()]
    );

    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 네이버 도서 검색 API 프록시 =====
app.get("/api/naver-book-search", async (req, res) => {
  const query = (req.query.query || "").toString().trim();

  if (!query) {
    return res.status(400).json({ ok: false, error: "query 파라미터가 필요합니다." });
  }

  const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(500).json({ ok: false, error: "네이버 API 키 미설정" });
  }

  const url =
    "https://openapi.naver.com/v1/search/book.json" +
    `?query=${encodeURIComponent(query)}` +
    "&display=10&start=1";

  try {
    const resp = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
      }
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Naver API error:", data);
      return res.status(500).json({
        ok: false,
        error: "네이버 API 오류",
        detail: data
      });
    }

    res.json({ ok: true, items: data.items || [] });
  } catch (e) {
    console.error("Naver API 호출 실패:", e);
    res.status(500).json({ ok: false, error: "서버에서 네이버 API 호출 실패" });
  }
});

// ===== 관리자: 역할 설정 =====
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

// ===== 도서 API =====
app.get("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const className = user.class_name;
    if (!className) {
      return res.json({ ok: true, books: [] });
    }

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

app.post("/api/books", requireRole(["teacher", "admin"]), async (req, res) => {
  const { class_name, title, author, pages } = req.body;
  if (!class_name || !title || !pages) {
    return res.status(400).json({ ok: false, error: "반, 제목, 전체 쪽수는 필수" });
  }

  try {
    const user = req.user;

    if (user.role !== "admin" && user.class_name !== class_name) {
      return res.status(403).json({ ok: false, error: "자신의 반 도서만 등록할 수 있습니다." });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO books (class_name, title, author, pages)
      VALUES ($1, $2, $3, $4)
      RETURNING id, class_name, title, author, pages
      `,
      [class_name.trim(), title.trim(), (author || "").trim(), pages]
    );
    res.json({ ok: true, book: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 도서 삭제 API =====
app.delete("/api/books/:id", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const className = user.class_name;
    const id = req.params.id;

    if (!className) {
      return res.status(400).json({ ok: false, error: "먼저 교사용 반을 설정해야 합니다." });
    }

    const { rows } = await pool.query(
      "SELECT id FROM books WHERE id = $1 AND class_name = $2",
      [id, className]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "해당 반에서 찾을 수 없는 도서입니다." });
    }

    const used = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM records WHERE book_id = $1 AND class_name = $2",
      [id, className]
    );

    if (used.rows[0].cnt > 0) {
      return res.status(400).json({
        ok: false,
        error: "이미 학생 기록에 사용 중인 도서입니다. 기록을 먼저 정리한 뒤 삭제해주세요."
      });
    }

    const result = await pool.query(
      "DELETE FROM books WHERE id = $1 AND class_name = $2",
      [id, className]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "도서를 찾을 수 없습니다." });
    }

    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 기록 API =====
app.post("/api/records", requireRole(["student", "teacher", "admin"]), async (req, res) => {
  const { studentName, className, bookId, todayPages, lastPage, targetPages } = req.body;

  if (!studentName || !className || !bookId || !todayPages) {
    return res.status(400).json({ ok: false, error: "필수 항목 누락" });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const bookCheck = await pool.query(
      "SELECT id, class_name FROM books WHERE id = $1",
      [bookId]
    );

    if (bookCheck.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "선택한 도서를 찾을 수 없습니다." });
    }

    if (bookCheck.rows[0].class_name !== className) {
      return res.status(400).json({ ok: false, error: "해당 반의 도서만 기록할 수 있습니다." });
    }

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

app.get("/api/records", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const requestedClassName = req.query.classname;

    let className = user.class_name;

    if (user.role === "admin" && requestedClassName) {
      className = requestedClassName === "ALL" ? null : requestedClassName;
    }

    if (!className && user.role !== "admin") {
      return res.json({ ok: true, records: [] });
    }

    let query = `
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
    `;
    let params = [];

    if (className) {
      query += ` WHERE r.class_name = $1 `;
      params.push(className);
    }

    query += ` ORDER BY r.id ASC `;

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, records: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 기록 삭제 API =====
app.delete("/api/records/:id", requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const user = req.user;
    const className = user.class_name;
    const id = req.params.id;

    let result;

    if (user.role === "admin") {
      result = await pool.query(
        `
        DELETE FROM records
        WHERE id = $1
        `,
        [id]
      );
    } else {
      result = await pool.query(
        `
        DELETE FROM records
        WHERE id = $1 AND class_name = $2
        `,
        [id, className]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "기록을 찾을 수 없습니다." });
    }

    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "서버 오류" });
  }
});

// ===== 서버 시작 =====
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
