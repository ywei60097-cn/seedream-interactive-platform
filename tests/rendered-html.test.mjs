import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the Seedream interactive editor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /豆包画梦工作室/);
  assert.match(html, /上传图片开始创作/);
  assert.match(html, /任意标记/);
  assert.match(html, /坐标定位/);
  assert.match(html, /交互编辑/);
  assert.match(html, /图层分离/);
});

test("includes a documented layer-separation adapter", async () => {
  const [route, page, env, readme] = await Promise.all([
    readFile(new URL("../app/api/layers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(route, /LAYER_SEPARATION_ENDPOINT/);
  assert.match(route, /findProviderLayers/);
  assert.match(route, /data\.layers/);
  assert.match(page, /separateLayers/);
  assert.match(page, /在交互编辑中打开/);
  assert.match(page, /图层分离完成/);
  assert.match(page, /mark-intent-panel/);
  assert.match(page, /download-toast/);
  assert.match(page, /reorderLayer/);
  assert.match(env, /LAYER_SEPARATION_MODEL/);
  assert.match(readme, /图层分离工作区/);
  await readFile(new URL("../app/editor.css", import.meta.url), "utf8");
});
