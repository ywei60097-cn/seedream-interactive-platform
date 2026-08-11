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
  assert.match(page, /分离引导/);
  assert.match(page, /手动引导/);
  assert.match(page, /activeMarkRef/);
  assert.match(page, /clearCurrentImage/);
  assert.match(page, /resetLayerResults/);
  assert.match(page, /image-source-tray/);
  assert.match(page, /replaceActiveSource/);
  assert.match(page, /正在读取图片/);
  assert.match(page, /保持与原始 Demo 相同的单步上传/);
  assert.match(page, /FileReader 读完立即设置画布主图/);
  assert.match(page, /优化提示词/);
  assert.match(page, /多个对象必须分别输出为独立的透明图层/);
  assert.match(page, /请填写编辑指令，或为至少一个标记填写编辑意图/);
  assert.match(page, /切换、替换或删除当前图片会清空旧图层结果/);
  assert.match(page, /coordinateTokens: buildCoordinateTokens/);
  assert.match(route, /Seedream 5\.0 Pro 图层拆分走 ImageGenerations 的独立开关/);
  assert.match(route, /layer_decomposition: true/);
  assert.match(route, /toLayerBoundingBox/);
  assert.match(route, /图层分离服务返回了非 JSON 内容/);
  assert.match(route, /不要包含方括号、圆括号或 Markdown 链接/);
  assert.match(page, /工作台接口返回了非 JSON 页面/);
  assert.doesNotMatch(route, /sequential_image_generation/);
  assert.doesNotMatch(route, /max_images/);
  assert.match(await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"), /referenceImages/);
  assert.match(env, /LAYER_SEPARATION_MODEL/);
  assert.match(readme, /图层分离工作区/);
  await readFile(new URL("../app/editor.css", import.meta.url), "utf8");
});
