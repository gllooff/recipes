const URL = "https://sckxvrktfluxfnjvupwu.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNja3h2cmt0Zmx1eGZuanZ1cHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODI4MjgsImV4cCI6MjEwMTM1ODgyOH0.no3qEZEyOY2YpYyF38YX6bBU_YbA9RhSGqymvF5xnls";

async function token(email: string, password: string) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, status: res.status, body };
  const user = body.user;
  const jwt = body.access_token;
  const claim = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return {
    ok: true,
    status: res.status,
    email: user?.email,
    role: claim?.app_metadata?.app_role,
    jwt,
  };
}

async function db(jwt: string, method: string, path: string, body?: object) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

const reader = await token("reader@example.com", "80651");
console.log("reader login:", reader.ok ? "OK" : "FAIL", reader.ok ? `role=${reader.role}` : JSON.stringify(reader.body));

if (reader.ok) {
  const read = await db(reader.jwt, "GET", "recipes?select=id,title&limit=1");
  console.log("reader GET /recipes:", read.status, read.status === 200 ? "(read OK)" : "(FAIL)");

  const insert = await db(reader.jwt, "POST", "recipes", { title: "should not be allowed" });
  console.log("reader POST /recipes:", insert.status, insert.status === 403 ? "(write blocked OK)" : "(unexpected)");
}
