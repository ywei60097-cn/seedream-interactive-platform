export const runtime = "edge";

const MIN_OUTPUT_PIXELS = 1280 * 720;
const MAX_OUTPUT_PIXELS = 4_624_220;
const MAX_INPUT_DATA_URL_LENGTH = 24 * 1024 * 1024;

function summarizeImageValue(value: unknown) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("data:image/")) return value;
  const separator = value.indexOf(",");
  return `${separator >= 0 ? value.slice(0, separator) : "data:image"},<省略 ${value.length.toLocaleString()} 个字符>`;
}

function debugRequestBody(body: Record<string, unknown>) {
  return {
    ...body,
    image: Array.isArray(body.image) ? body.image.map(summarizeImageValue) : body.image,
  };
}

function debugArkPayload(payload: { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } }) {
  return {
    ...payload,
    data: payload.data?.map(item => ({
      ...item,
      b64_json: item.b64_json ? `<省略 ${item.b64_json.length.toLocaleString()} 个 Base64 字符>` : item.b64_json,
    })),
  };
}

function toExplicitSize(widthValue: unknown, heightValue: unknown) {
  const width = Math.round(Number(widthValue));
  const height = Math.round(Number(heightValue));
  const aspectRatio = width / height;
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || aspectRatio < 1 / 16 || aspectRatio > 16 || pixels < MIN_OUTPUT_PIXELS || pixels > MAX_OUTPUT_PIXELS) return null;
  return `${width}x${height}`;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ARK_API_KEY; const model = process.env.ARK_MODEL_ID || "doubao-seedream-5-0-pro-260628";
    if (!apiKey) return Response.json({ error: "服务端尚未配置 ARK_API_KEY" }, { status: 503 });
    const clientPayload = await request.json() as Record<string, unknown>;
    const { prompt, image: submittedImage, source, marked, referenceImages = [], coordinateTokens = [], markInstructions = "", interactionMode = "mark", ratio = "1:1", outputWidth = 1024, outputHeight = 1024, imageArea = false, resolution = "1K", advanced = {} } = clientPayload; const debug = clientPayload.debug === true;
    const isCoordinateMode = interactionMode === "coordinate";
    // `image` 是新版前端只提交的一张有效输入图；保留 source/marked 兼容旧客户端。
    const inputImage = typeof submittedImage === "string" ? submittedImage : (isCoordinateMode ? source : (marked || source));
    if (!prompt || typeof inputImage !== "string") return Response.json({ error: "缺少图片或编辑指令" }, { status: 400 });
    if (inputImage.length > MAX_INPUT_DATA_URL_LENGTH) return Response.json({ error: "输入图片过大，请压缩到 18MB 以内后重试。" }, { status: 413 });
    const safeReferenceImages = Array.isArray(referenceImages) ? referenceImages.filter((value): value is string => typeof value === "string" && value.startsWith("data:image/") && value.length <= MAX_INPUT_DATA_URL_LENGTH && value !== inputImage).slice(0, 9) : [];
    const inputImages = [inputImage, ...safeReferenceImages];
    const size = imageArea ? (resolution === "2K" ? "2K" : "1K") : toExplicitSize(outputWidth, outputHeight);
    if (!size) return Response.json({ error: "输出尺寸需满足总像素范围 921600 至 4624220，且宽高比在 1:16 至 16:1 之间。" }, { status: 400 });
    const ratioInstruction = imageArea && ratio !== "自定义" ? `输出图片比例为 ${ratio}。` : "";
    const safeCoordinateTokens = Array.isArray(coordinateTokens) ? coordinateTokens.filter((token): token is string => typeof token === "string" && /^图1(?:<point>\d+\s+\d+<\/point>|<bbox>\d+\s+\d+\s+\d+\s+\d+<\/bbox>)$/.test(token)).slice(0, 20) : [];
    const coordinateInstruction = safeCoordinateTokens.length ? `交互坐标定位（相对于图1，坐标范围0至999）：${safeCoordinateTokens.join("；")}。请严格以这些坐标定位编辑目标。` : "";
    const markInstruction = typeof markInstructions === "string" && markInstructions.length <= 2_000 ? `各标记的编辑意图：${markInstructions}。` : "";
    const referenceInstruction = safeReferenceImages.length ? `图1为当前编辑主图；图2至图${inputImages.length}为参考图，请仅按需要提取其特征。` : "";
    const enhancedPrompt = isCoordinateMode
      ? `请根据图1完成精准图片编辑。${referenceInstruction}${coordinateInstruction}${markInstruction}用户要求：${prompt}。${ratioInstruction}仅修改坐标所指区域；保持构图、人物身份和未指定区域与原图一致，使结果自然融合。`
      : `请根据图1中的手绘草图、涂鸦、圈选、箭头或标记区域进行图片编辑。${referenceInstruction}${markInstruction}用户要求：${prompt}。${ratioInstruction}仅修改标记所指区域；移除所有草图和标记线条；保持构图、人物身份和未标记区域与原图一致，使结果自然融合。`;
    const outputFormat = advanced.outputFormat === "jpeg" ? "jpeg" : "png";
    // 任意标记模式只传带标记的图；坐标定位模式只传原图和坐标 Prompt，避免两个模式相互干扰。
    // 使用 Base64 返回结果，避免跨域图片污染浏览器画布，确保结果图能继续标注和再次编辑。
    const requestBody: Record<string, unknown> = { model, prompt: enhancedPrompt, image: inputImages, size, output_format: outputFormat, response_format: "b64_json", watermark: Boolean(advanced.watermark), optimize_prompt_options: { mode: "standard" } };
    const arkResponse = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
    const payload = await arkResponse.json() as { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } };
    // 本地调试默认开启，但不能把输入/输出图片再复制进 JSON 响应，否则大图会导致浏览器连接中断。
    const debugPayload = debug ? { debug: { arkRequest: debugRequestBody(requestBody), arkResponse: debugArkPayload(payload) } } : {};
    if (!arkResponse.ok) return Response.json({ error: payload.error?.message || `方舟请求失败（${arkResponse.status}）`, ...debugPayload }, { status: arkResponse.status });
    const first = payload.data?.[0]; const mime = outputFormat === "jpeg" ? "image/jpeg" : "image/png"; const image = first?.url || (first?.b64_json ? `data:${mime};base64,${first.b64_json}` : ""); if (!image) return Response.json({ error: "方舟未返回图片", ...debugPayload }, { status: 502 }); return Response.json({ image, ...debugPayload });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "生成请求失败" }, { status: 500 }); }
}
