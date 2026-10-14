// Token-bearing URL stays in a GitHub environment secret, never in source/logs.
const value = process.env.DOKPLOY_DEPLOY_WEBHOOK;
try {
  if (!value) throw new Error("Missing webhook");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.pathname.startsWith("/api/deploy/") ||
    url.username ||
    url.password
  )
    throw new Error("Invalid webhook");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  // Dokploy may return 301 for a mismatched image/tag/branch; it is not success.
  if (response.status !== 200) throw new Error("Deploy rejected");
  console.log(
    "Dokploy accepted the deployment request. Check rollout health in Dokploy.",
  );
} catch {
  console.error(
    "Deployment request failed. Check the production secret and Dokploy application configuration.",
  );
  process.exitCode = 1;
}
