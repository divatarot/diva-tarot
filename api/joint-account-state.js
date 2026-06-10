const DATA_KEY = "joint-account-system:state";
const DEFAULT_CLIENT_TOKEN = "4c129f69f551195cbc5e8b57cc5a0975b6efa1e8510573524d11df03c7d010c6";

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function upstash(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error("missing Upstash REST configuration");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error || "Upstash request failed");
    error.statusCode = response.status || 500;
    throw error;
  }
  return payload.result;
}

module.exports = async function handler(request, response) {
  try {
    const expectedToken = process.env.JOINT_ACCOUNT_API_TOKEN || DEFAULT_CLIENT_TOKEN;
    if (request.headers["x-joint-account-token"] !== expectedToken) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (request.method === "GET") {
      const raw = await upstash(["GET", DATA_KEY]);
      sendJson(response, 200, raw ? JSON.parse(raw) : {});
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const state = JSON.parse(body || "{}");
      state.updatedAt = Date.now();
      await upstash(["SET", DATA_KEY, JSON.stringify(state)]);
      sendJson(response, 200, state);
      return;
    }

    sendJson(response, 405, { error: "method not allowed" });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "server error" });
  }
};
