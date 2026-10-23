import { whoopGet } from "./whoop-client.js";

const requests: { path: string; params?: Record<string, string | number> }[] = [
  { path: "/user/profile/basic" },
  { path: "/recovery", params: { limit: 1 } },
];

for (const { path, params } of requests) {
  const query = params ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : "";
  console.error(`\nGET ${path}${query}`);
  try {
    const data = await whoopGet(path, params);
    console.error("Status: 200");
    console.error(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Request failed");
  }
}
