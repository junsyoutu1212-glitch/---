// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = "468945736758-5qec11vjns3jhta8sm6v936bp5nv39p0.apps.googleusercontent.com"
const ADMIN_SECRET = "CLASSROOM-SECRET";

if (!CLIENT_ID) {
  console.warn("⚠ GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.");
}

const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // public/index.html 제공

// ---- 메모리 사용자/역할 저장 (이메일 기준) ----
/**
 * users 구조:
 * {
 *   [email]: {
 *      email,
 *      name,
 *      picture,
 *      role: 'student' | 'teacher' | 'admin'
 *   }
 * }
 */
const users = {};

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
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Google 로그인: 토큰 검증 + 사용자 정보/역할 반환
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
      return res.status(400).json({ ok: false, error: "Google 계정 이메일 정보를 가져오지 못했습니다." });
    }

    // 기존에 있으면 그대로, 없으면 기본 role=student 로 생성
    if (!users[email]) {
      users[email] = {
        email,
        name,
        picture,
        role: "student"
      };
    } else {
      users[email].name = name;
      users[email].picture = picture;
    }

    res.json({
      ok: true,
      user: users[email]
    });
  } catch (err) {
    console.error("Google ID 토큰 검증 실패:", err.message);
    res.status(401).json({ ok: false, error: "유효하지 않은 Google ID 토큰입니다." });
  }
});

// ---- 관리자용: 역할 변경 API (이메일 기준) ----
// 예: 크롬 콘솔에서
// fetch("/admin/set-role", {
//   method: "POST",
//   headers: { "Content-Type": "application/json" },
//   body: JSON.stringify({
//     email: "교사메일@example.com",
//     role: "teacher",   // student | teacher | admin
//     secret: "CLASSROOM-SECRET"
//   })
// }).then(r=>r.json()).then(console.log);
app.post("/admin/set-role", (req, res) => {
  const { email, role, secret } = req.body;

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "관리자 비밀 코드가 올바르지 않습니다." });
  }
  if (!email) {
    return res.status(400).json({ ok: false, error: "email이 필요합니다." });
  }
  if (!["student", "teacher", "admin"].includes(role)) {
    return res.status(400).json({ ok: false, error: "역할은 student | teacher | admin 중 하나여야 합니다." });
  }
  if (!users[email]) {
    return res.status(404).json({ ok: false, error: "해당 이메일 사용자가 없습니다. 먼저 Google 로그인으로 생성해 주세요." });
  }

  users[email].role = role;
  res.json({ ok: true, user: users[email] });
});

// ---- 관리자용: 전체 사용자/역할 조회 ----
// fetch("/admin/users?secret=CLASSROOM-SECRET").then(r=>r.json()).then(console.log);
app.get("/admin/users", (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "관리자 비밀 코드가 올바르지 않습니다." });
  }
  res.json({ ok: true, users });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
