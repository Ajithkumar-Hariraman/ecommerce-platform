import { loadEnvFile } from "node:process";
loadEnvFile(new URL("../../infra/.env", import.meta.url));
const issuer = "http://127.0.0.1:8180/realms/ecommerce";
const response = await fetch(issuer + "/protocol/openid-connect/token", {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "ecommerce-cli-manager",
    client_secret: process.env.ECOMMERCE_MANAGER_CLIENT_SECRET,
  }),
});
if (!response.ok) throw new Error("Local diagnostic token unavailable");
const { access_token } = await response.json();
const id = process.argv[2] ?? "d24b1395-3d1d-4e49-a170-1d327868269a";
for (const base of ["http://127.0.0.1:3001", "http://localhost:8088"]) {
  for (const [method, path, authenticated] of [
    ["GET", `/api/v1/orders/${id}`, true],
    ["GET", "/api/v1/orders/00000000-0000-4000-8000-000000000001", true],
    ["POST", `/api/v1/orders/${id}/checkout`, true],
    ["GET", `/api/v1/orders/${id}`, false],
  ]) {
    const r = await fetch(base + path, {
      method,
      headers: authenticated ? { Authorization: "Bearer " + access_token } : {},
    });
    const body = await r.json();
    console.log(
      JSON.stringify({
        base,
        method,
        path,
        status: r.status,
        ...(body.error
          ? { error: body.error.message }
          : {
              id: body.id,
              total: body.totalInMinorUnits,
              statusValue: body.status,
              paymentId: body.paymentId,
            }),
      }),
    );
  }
}
