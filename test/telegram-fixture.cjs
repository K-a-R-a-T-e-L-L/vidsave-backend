const http = require("node:http");
let attempts = 0,
  successes = 0;
const ids = [];
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/status") {
    response.end(JSON.stringify({ attempts, successes, ids }));
    return;
  }
  if (
    request.method !== "POST" ||
    request.url !== "/botstage5_fixture_token/sendMessage"
  ) {
    response.statusCode = 404;
    response.end("{}");
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 16000) request.destroy();
  });
  request.on("end", () => {
    try {
      const data = JSON.parse(body);
      if (data.chat_id !== "stage5-fixture-chat") throw new Error();
      attempts++;
      if (attempts === 1) {
        response.statusCode = 503;
        response.end('{"ok":false}');
        return;
      }
      successes++;
      ids.push(String(data.text).match(/Новая заявка ([a-f0-9-]+)/)?.[1]);
      response.end('{"ok":true,"result":{"message_id":1}}');
    } catch {
      response.statusCode = 400;
      response.end('{"ok":false}');
    }
  });
});
server.listen(8080, "0.0.0.0");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
