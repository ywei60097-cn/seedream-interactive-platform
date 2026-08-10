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
  z_index?: number;
  description?: string;
  bounding_box?: { absolute?: number[]; normalized?: number[] };
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
  const zIndex = Number.isFinite(layer.z_index) ? layer.z_index : index;
  return {
    id: layer.id || `layer-${zIndex}`,
    name: layer.name || layer.label || (zIndex === 0 ? "背景底图" : `图层 ${zIndex}`),
    kind: layer.description || layer.kind || layer.type || (zIndex === 0 ? "底图" : "独立素材"),
    image,
    zIndex,
    boundingBox: layer.bounding_box,
  };
}

function toLayerBoundingBox(token: string) {
  const point = token.match(/^图1<point>(\d+)\s+(\d+)<\/point>$/);
  if (point) {
    const x = Number(point[1]), y = Number(point[2]);
    return `<bbox>${Math.max(0, x - 8)} ${Math.max(0, y - 8)} ${Math.min(1000, x + 8)} ${Math.min(1000, y + 8)}</bbox>`;
  }
  return token.replace(/^图1/, "");
}

export async function POST(request: Request) {
  try {
    const { image, prompt, coordinateTokens = [], markInstructions = "" } = await request.json() as { image?: unknown; prompt?: unknown; coordinateTokens?: unknown; markInstructions?: unknown };
    if (typeof image !== "string" || !image.startsWith("data:image/")) return Response.json({ error: "请先上传一张有效图片" }, { status: 400 });
    if (image.length > MAX_INPUT_DATA_URL_LENGTH) return Response.json({ error: "输入图片过大，请压缩到 18MB 以内后重试。" }, { status: 413 });

    // Seedream 5.0 Pro 图层拆分走 ImageGenerations 的独立开关，而非组图输出。
    const endpoint = process.env.LAYER_SEPARATION_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/images/generations";
    const apiKey = process.env.LAYER_SEPARATION_API_KEY || process.env.ARK_API_KEY;
    const model = process.env.LAYER_SEPARATION_MODEL || process.env.ARK_MODEL_ID || "doubao-seedream-5-0-pro-260628";
    if (!apiKey) return Response.json({ error: "服务端尚未配置图层分离服务。请设置 LAYER_SEPARATION_API_KEY（或 ARK_API_KEY）。" }, { status: 503 });

    const safeTokens = Array.isArray(coordinateTokens) ? coordinateTokens.filter((token): token is string => typeof token === "string" && /^图1(?:<point>\d+\s+\d+<\/point>|<bbox>\d+\s+\d+\s+\d+\s+\d+<\/bbox>)$/.test(token)).slice(0, 16) : [];
    const safeMarkInstructions = typeof markInstructions === "string" ? markInstructions.slice(0, 2_000) : "";
    // 图层拆分文档定义坐标输入为 <bbox>；点标记转换成一个小型 bbox。
    const coordinates = safeTokens.map(toLayerBoundingBox);
    const userPrompt = typeof prompt === "string" ? prompt.trim().slice(0, 2_000) : "";
    const guidance = [userPrompt, safeMarkInstructions, coordinates.length ? `请精确拆分以下选区：${coordinates.join("、")}` : ""].filter(Boolean);
    // 不传 prompt 时，5.0 Pro 会自动识别并拆分主要元素；传入时只拆分所描述的元素。
    const providerBody = {
      model,
      image,
      size: "auto",
      output_format: "jpeg",
      layer_decomposition: true,
      watermark: false,
      ...(guidance.length ? { prompt: `将图片进行精确图层分离。${guidance.join("；")}。` } : {}),
    };

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
    if (!layers.length) return Response.json({ error: "图层分离服务未返回 data 图层数组。" }, { status: 502 });
    return Response.json({ layers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图层分离请求失败" }, { status: 500 });
  }
}
