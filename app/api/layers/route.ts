export const runtime = "edge";

const MAX_INPUT_DATA_URL_LENGTH = 24 * 1024 * 1024;

type ProviderLayer = {
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
  type?: string;
  image?: string;
  url?: string;
  image_url?: string;
  b64_json?: string;
  mime_type?: string;
};

function findProviderLayers(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | ProviderLayer[] | undefined;
  const candidates = [
    Array.isArray(data) ? data : undefined,
    Array.isArray(payload.layers) ? payload.layers : undefined,
    !Array.isArray(data) && Array.isArray(data?.layers) ? data.layers : undefined,
    Array.isArray((payload.output as Record<string, unknown> | undefined)?.layers) ? (payload.output as Record<string, unknown>).layers : undefined,
    Array.isArray((payload.result as Record<string, unknown> | undefined)?.layers) ? (payload.result as Record<string, unknown>).layers : undefined,
  ];
  return (candidates.find(Array.isArray) || []) as ProviderLayer[];
}

function normalizeLayer(layer: ProviderLayer, index: number) {
  const image = layer.image || layer.image_url || layer.url || (layer.b64_json ? `data:${layer.mime_type || "image/png"};base64,${layer.b64_json}` : "");
  return { id: layer.id || `layer-${index + 1}`, name: layer.name || layer.label || `图层 ${index + 1}`, kind: layer.kind || layer.type || "独立素材", image };
}

export async function POST(request: Request) {
  try {
    const { image, prompt, coordinateTokens = [], markInstructions = "" } = await request.json() as { image?: unknown; prompt?: unknown; coordinateTokens?: unknown; markInstructions?: unknown };
    if (typeof image !== "string" || !image.startsWith("data:image/")) return Response.json({ error: "请先上传一张有效图片" }, { status: 400 });
    if (image.length > MAX_INPUT_DATA_URL_LENGTH) return Response.json({ error: "输入图片过大，请压缩到 18MB 以内后重试。" }, { status: 413 });

    // 图层分离服务由环境变量指定，避免将尚未公开或不同环境的 API 契约硬编码在浏览器中。
    const endpoint = process.env.LAYER_SEPARATION_ENDPOINT;
    const apiKey = process.env.LAYER_SEPARATION_API_KEY || process.env.ARK_API_KEY;
    const model = process.env.LAYER_SEPARATION_MODEL || process.env.ARK_MODEL_ID || "doubao-seedream-5-0-pro-260628";
    if (!endpoint || !apiKey) return Response.json({ error: "服务端尚未配置图层分离服务。请设置 LAYER_SEPARATION_ENDPOINT 与 LAYER_SEPARATION_API_KEY（或 ARK_API_KEY）。" }, { status: 503 });

    const safeTokens = Array.isArray(coordinateTokens) ? coordinateTokens.filter((token): token is string => typeof token === "string" && /^图1(?:<point>\d+\s+\d+<\/point>|<bbox>\d+\s+\d+\s+\d+\s+\d+<\/bbox>)$/.test(token)).slice(0, 20) : [];
    const safeMarkInstructions = typeof markInstructions === "string" ? markInstructions.slice(0, 2_000) : "";
    const selectionInstruction = safeTokens.length ? `手动定位：${safeTokens.join("；")}。` : "";
    const separationPrompt = `请根据图1生成可独立使用的图层素材。${selectionInstruction}${safeMarkInstructions ? `用户标注意图：${safeMarkInstructions}。` : ""}${typeof prompt === "string" && prompt.trim() ? `用户要求：${prompt.trim()}。` : "请优先提取画面主体，保持边缘干净，并保持未选区域不变。"}`;
    // 兼容用户将方舟 ImageGenerations 配置为图层服务的场景：该端点要求 model 与 prompt。
    const isArkImageGeneration = /\/images\/generations(?:\?|$)/.test(endpoint);
    const providerBody = isArkImageGeneration
      // 方舟单图生图的 `image` 是单个图片字符串；数组只用于多参考图场景。
      ? { model, prompt: separationPrompt, image, size: "1K", sequential_image_generation: "disabled", response_format: "url", watermark: false }
      : { model, image: [image], prompt: separationPrompt, response_format: "b64_json" };

    const providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(providerBody),
    });
    const payload = await providerResponse.json() as Record<string, unknown>;
    if (!providerResponse.ok) {
      const message = (payload.error as { message?: string } | undefined)?.message || (typeof payload.message === "string" ? payload.message : `图层分离服务请求失败（${providerResponse.status}）`);
      return Response.json({ error: message }, { status: providerResponse.status });
    }
    const layers = findProviderLayers(payload).map(normalizeLayer).filter(layer => layer.image);
    if (!layers.length) return Response.json({ error: "图层分离服务响应格式无法识别；请确认接口返回 data.layers、layers、output.layers 或 result.layers。" }, { status: 502 });
    return Response.json({ layers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图层分离请求失败" }, { status: 500 });
  }
}
