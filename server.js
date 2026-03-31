import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = 468945736758-5qec11vjns3jhta8sm6v936bp5nv39p0.apps.googleusercontent.com;

if (!CLIENT_ID) {
  console.warn("⚠ GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.");
}

const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // public 폴더에 index.html 넣는다고 가정

// Google ID 토큰 검증 함수
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID
  });
  const payload = ticket.getPayload();
  return payload; // sub, email, name, picture 등 포함
}

// 헬스 체크
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Google 로그인 토큰 검증 엔드포인트
app.post("/auth/google", async (req, res) => {
  const { credential } = req.body; // 프런트에서 보내는 ID 토큰

  if (!credential) {
    return res.status(400).json({ error: "credential(ID 토큰)이 없습니다." });
  }

  try {
    const payload = await verifyGoogleToken(credential);

    // payload 예시: { sub, email, email_verified, name, picture, ... }
    const user = {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified,
      name: payload.name,
      picture: payload.picture
    };

    // 여기에서 DB 저장/조회, 세션/쿠키 설정 등을 할 수 있음
    // 이 예제에서는 민감 정보 최소화해서 그대로 응답만
    res.json({
      ok: true,
      user
    });
  } catch (err) {
    console.error("Google ID 토큰 검증 실패:", err.message);
    res.status(401).json({ ok: false, error: "유효하지 않은 Google ID 토큰입니다." });
  }
});

// (추가) 학생 기록 저장/조회 API를 나중에 여기에 붙일 수 있음
// app.post("/api/records", ...)
// app.get("/api/records", ...)

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
