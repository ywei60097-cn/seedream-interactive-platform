"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

type Tool = "move" | "point" | "rect" | "brush" | "arrow";
type Point = { x: number; y: number };
type Mark = { id: string; tool: Exclude<Tool, "move">; color: string; opacity: number; width: number; points: Point[]; number: number; intent: string };
type Panel = "ratio" | "advanced" | null;
type InteractionMode = "mark" | "coordinate";
type DebugTrace = { clientRequest: unknown; arkRequest?: unknown; arkResponse?: unknown; appResponse?: unknown };
type Advanced = { outputFormat: "png" | "jpeg"; watermark: boolean };
type Workspace = "edit" | "layers";
type LayerGroup = "人物" | "前景" | "背景" | "其他";
type LayerBounds = { absolute?: number[]; normalized?: number[] };
type SeparatedLayer = { id: string; name: string; image: string; visible: boolean; opacity: number; kind?: string; group: LayerGroup; order: number; zIndex: number; boundingBox?: LayerBounds };

const COLORS = ["#ff453a", "#ff9f0a", "#ffd60a", "#a8ff70", "#64d8cb", "#64a8ff", "#8e8cff", "#d77dff", "#ffffff"];
const RATIOS = [
  { value: "16:9", w: 16, h: 9, width: 1280, height: 720 }, { value: "3:2", w: 3, h: 2, width: 1248, height: 832 }, { value: "4:3", w: 4, h: 3, width: 1152, height: 864 },
  { value: "1:1", w: 1, h: 1, width: 1024, height: 1024 }, { value: "3:4", w: 3, h: 4, width: 864, height: 1152 }, { value: "2:3", w: 2, h: 3, width: 832, height: 1248 }, { value: "9:16", w: 9, h: 16, width: 720, height: 1280 },
];
const DEFAULT_ADVANCED: Advanced = { outputFormat: "png", watermark: false };
const TOOL_INFO: Record<Tool, { icon: string; label: string }> = {
  move: { icon: "✋", label: "移动画布" }, point: { icon: "◎", label: "点标记" }, rect: { icon: "□", label: "矩形选区" }, brush: { icon: "⌁", label: "画笔" }, arrow: { icon: "↗", label: "箭头" },
};
const LAYER_GROUPS: LayerGroup[] = ["人物", "前景", "背景", "其他"];
const inferLayerGroup = (name: string, kind = ""): LayerGroup => {
  const value = `${name} ${kind}`.toLowerCase();
  if (/人物|人像|human|person|portrait|subject/.test(value)) return "人物";
  if (/背景|天空|建筑|background|scene/.test(value)) return "背景";
  if (/前景|物体|产品|道具|foreground|object|product/.test(value)) return "前景";
  return "其他";
};

function Icon({ children }: { children: React.ReactNode }) { return <span aria-hidden>{children}</span>; }

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Pointer handlers run before React has necessarily committed state updates.
  // Keep the active gesture in refs so a quick click or drag cannot lose its mark.
  const activeMarkRef = useRef<Mark | null>(null);
  const panDragRef = useRef<Point | null>(null);
  const layerRequestRef = useRef(0);
  const layerProgressTimerRef = useRef<number | null>(null);
  const layerImagesRef = useRef(new Map<string, HTMLImageElement>());
  const toastTimerRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState("");
  // `source` is the original image used for layer decomposition.  Keep the
  // editor's input independent so opening a separated layer never replaces
  // the original image or corrupts the layer workspace on return.
  const [editorSource, setEditorSource] = useState("");
  const [editorSourceLabel, setEditorSourceLabel] = useState("原图");
  const [tool, setTool] = useState<Tool>("point");
  const [color, setColor] = useState(COLORS[3]);
  const [opacity, setOpacity] = useState(0.65);
  const [brushWidth, setBrushWidth] = useState(12);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redoStack, setRedoStack] = useState<Mark[]>([]);
  const [active, setActive] = useState<Mark | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [outputWidth, setOutputWidth] = useState(1024);
  const [outputHeight, setOutputHeight] = useState(1024);
  const [imageArea, setImageArea] = useState(false);
  const [resolution, setResolution] = useState("1K");
  const [advanced, setAdvanced] = useState<Advanced>(DEFAULT_ADVANCED);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("mark");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("edit");
  const [layers, setLayers] = useState<SeparatedLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [separating, setSeparating] = useState(false);
  const [layerError, setLayerError] = useState("");
  const [layerProgress, setLayerProgress] = useState(0);
  const [layerStage, setLayerStage] = useState("");
  const [draggedLayerId, setDraggedLayerId] = useState("");
  const [toast, setToast] = useState("");
  const selectedLayer = layers.find(layer => layer.id === selectedLayerId);
  const orderedLayers = [...layers].sort((a, b) => a.order - b.order);
  const backgroundLayer = orderedLayers.find(layer => layer.zIndex === 0);
  const layerPreviewOpacity = workspace === "layers" ? 1 : 1;
  const canvasSource = workspace === "layers" ? (backgroundLayer?.image || source) : (showResult && result ? result : editorSource);
  const visibleTools: Tool[] = workspace === "layers" ? ["move", "point", "rect", "brush"] : interactionMode === "coordinate" ? ["move", "point", "rect"] : ["move", "point", "rect", "brush", "arrow"];

  const imageBox = useCallback(() => {
    const img = imageRef.current, canvas = canvasRef.current;
    if (!img || !canvas) return null;
    const stageW = canvas.clientWidth, stageH = canvas.clientHeight;
    const fit = Math.min((stageW - 150) / img.naturalWidth, (stageH - 30) / img.naturalHeight);
    const w = img.naturalWidth * fit, h = img.naturalHeight * fit;
    return { fit, w, h, x: (stageW / zoom - w) / 2, y: (stageH / zoom - h) / 2 };
  }, [zoom]);

  const drawMark = useCallback((ctx: CanvasRenderingContext2D, mark: Mark) => {
    if (!mark.points.length) return;
    ctx.save(); ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.globalAlpha = mark.opacity; ctx.lineWidth = mark.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const a = mark.points[0], b = mark.points.at(-1)!;
    if (mark.tool === "brush") {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); mark.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    } else if (mark.tool === "rect") {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.globalAlpha = 0.18; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h);
      ctx.font = "14px Arial"; const label = `区域${String(mark.number).padStart(2, "0")}`; const tw = ctx.measureText(label).width + 20;
      ctx.fillRect(x, y - 31, tw, 28); ctx.fillStyle = "#101710"; ctx.fillText(label, x + 10, y - 11);
    } else if (mark.tool === "point") {
      const label = `标记${String(mark.number).padStart(2, "0")}`; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 58, a.y); ctx.stroke();
      ctx.font = "14px Arial"; const tw = ctx.measureText(label).width + 20; ctx.fillRect(a.x + 49, a.y - 18, tw, 36); ctx.fillStyle = "#103a35"; ctx.fillText(label, a.x + 59, a.y + 5);
    } else {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), head = 18 + mark.width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6)); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6)); ctx.stroke();
    }
    ctx.restore();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, img = imageRef.current, stage = stageRef.current; if (!canvas || !stage) return;
    const box = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), cssW = Math.max(320, Math.floor(box.width)), cssH = Math.max(320, Math.floor(box.height));
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) { canvas.width = cssW * dpr; canvas.height = cssH * dpr; canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`; }
    const ctx = canvas.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH); ctx.save(); ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
    if (img) { const box = imageBox(); if (box) { ctx.save(); if (workspace === "layers" && orderedLayers.length) { orderedLayers.filter(layer => layer.visible).forEach(layer => { const layerImage = layerImagesRef.current.get(layer.id); if (!layerImage?.complete) return; const normalized = layer.boundingBox?.normalized; const hasBounds = Array.isArray(normalized) && normalized.length === 4; const [x1, y1, x2, y2] = hasBounds ? normalized : [0, 0, 1000, 1000]; ctx.globalAlpha = layer.opacity / 100; ctx.drawImage(layerImage, box.x + box.w * (x1 / 1000), box.y + box.h * (y1 / 1000), box.w * ((x2 - x1) / 1000), box.h * ((y2 - y1) / 1000)); }); } else { ctx.globalAlpha = layerPreviewOpacity; ctx.drawImage(img, box.x, box.y, box.w, box.h); } ctx.restore(); } }
    marks.forEach(m => drawMark(ctx, m)); if (active) drawMark(ctx, active); ctx.restore();
  }, [active, drawMark, imageBox, layerPreviewOpacity, marks, orderedLayers, pan, workspace, zoom]);

  useEffect(() => { if (!canvasSource) { imageRef.current = null; draw(); return; } const img = new Image(); img.onload = () => { imageRef.current = img; draw(); }; img.src = canvasSource; }, [canvasSource, draw]);
  useEffect(() => { if (workspace !== "layers") return; orderedLayers.forEach(layer => { if (layerImagesRef.current.has(layer.id)) return; const image = new Image(); image.onload = () => { layerImagesRef.current.set(layer.id, image); draw(); }; image.src = layer.image; }); }, [draw, orderedLayers, workspace]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const resize = () => draw(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, [draw]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebugEnabled(window.location.hostname === "localhost" || new URLSearchParams(window.location.search).has("debug")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toCanvasPoint = (clientX: number, clientY: number) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom }; };
  const finishGesture = useCallback(() => {
    panDragRef.current = null;
    const completedMark = activeMarkRef.current;
    if (!completedMark) return;
    setMarks(old => [...old, completedMark]); setRedoStack([]); activeMarkRef.current = null; setActive(null);
  }, []);
  useEffect(() => {
    window.addEventListener("pointerup", finishGesture);
    window.addEventListener("pointercancel", finishGesture);
    return () => { window.removeEventListener("pointerup", finishGesture); window.removeEventListener("pointercancel", finishGesture); };
  }, [finishGesture]);
  const pointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Window-level fallback handles completion. */ }
    if (tool === "move" || !canvasSource) { panDragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; return; }
    const p = toCanvasPoint(e.clientX, e.clientY), number = marks.filter(m => m.tool === tool).length + 1;
    const nextMark = { id: crypto.randomUUID(), tool, color, opacity, width: tool === "brush" ? brushWidth : 4, points: [p], number, intent: "" } as Mark;
    if (nextMark.tool === "point") { setMarks(old => [...old, nextMark]); setRedoStack([]); return; }
    activeMarkRef.current = nextMark;
    setActive(nextMark);
  };
  const pointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragStart = panDragRef.current;
    if (dragStart) { setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); return; }
    const currentMark = activeMarkRef.current;
    if (!currentMark || currentMark.tool === "point") return;
    const p = toCanvasPoint(e.clientX, e.clientY), nextMark = { ...currentMark, points: currentMark.tool === "brush" ? [...currentMark.points, p] : [currentMark.points[0], p] };
    activeMarkRef.current = nextMark;
    setActive(nextMark);
  };
  const pointerUp = () => finishGesture();
  const clearEditingState = () => { activeMarkRef.current = null; panDragRef.current = null; setMarks([]); setRedoStack([]); setActive(null); setPan({ x: 0, y: 0 }); setZoom(1); };
  const switchInteractionMode = (nextMode: InteractionMode) => { if (nextMode === interactionMode) return; setInteractionMode(nextMode); setTool(nextMode === "coordinate" ? "point" : "brush"); clearEditingState(); setError(""); };
  const switchWorkspace = (nextWorkspace: Workspace) => { if (nextWorkspace === workspace) return; clearEditingState(); setWorkspace(nextWorkspace); setTool(nextWorkspace === "layers" ? "rect" : "point"); setLayerError(""); };
  const resetLayerResults = () => {
    layerRequestRef.current += 1;
    if (layerProgressTimerRef.current) window.clearInterval(layerProgressTimerRef.current);
    layerProgressTimerRef.current = null;
    layerImagesRef.current.clear(); setLayers([]); setSelectedLayerId(""); setLayerError(""); setLayerProgress(0); setLayerStage(""); setSeparating(false);
  };
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = String(reader.result);
      resetLayerResults(); setSource(image); setEditorSource(image); setEditorSourceLabel("原图"); setResult(""); setShowResult(false); setPrompt(""); clearEditingState();
    };
    reader.readAsDataURL(file);
  };
  const undo = () => setMarks(old => { const last = old.at(-1); if (last) setRedoStack(r => [...r, last]); return old.slice(0, -1); });
  const redo = () => setRedoStack(old => { const last = old.at(-1); if (last) setMarks(m => [...m, last]); return old.slice(0, -1); });
  const updateMark = (id: string, changes: Partial<Mark>) => setMarks(current => current.map(mark => mark.id === id ? { ...mark, ...changes } : mark));
  const removeMark = (id: string) => setMarks(current => current.filter(mark => mark.id !== id));

  const chooseRatio = (value: string, width: number, height: number) => { setRatio(value); setOutputWidth(width); setOutputHeight(height); };
  const resetRatio = () => { setRatio("1:1"); setOutputWidth(1024); setOutputHeight(1024); setImageArea(false); setResolution("1K"); };
  const exportMarkedImage = () => { const img = imageRef.current!, box = imageBox(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0); if (box) { ctx.save(); ctx.scale(1 / box.fit, 1 / box.fit); ctx.translate(-box.x, -box.y); marks.forEach(m => drawMark(ctx, m)); ctx.restore(); } return c.toDataURL("image/png"); };
  const buildCoordinateTokens = () => {
    const box = imageBox(); if (!box) return [];
    const coordinate = (point: Point) => ({ x: Math.max(0, Math.min(999, Math.round(((point.x - box.x) / box.w) * 1000))), y: Math.max(0, Math.min(999, Math.round(((point.y - box.y) / box.h) * 1000))) });
    return marks.flatMap(mark => {
      const first = mark.points[0], last = mark.points.at(-1); if (!first || !last) return [];
      if (mark.tool === "point" || mark.tool === "arrow") { const target = mark.tool === "arrow" ? last : first, p = coordinate(target); return [`图1<point>${p.x} ${p.y}</point>`]; }
      const margin = mark.tool === "brush" ? mark.width / 2 : 0, xs = mark.points.map(point => point.x), ys = mark.points.map(point => point.y);
      const start = coordinate({ x: Math.min(...xs) - margin, y: Math.min(...ys) - margin }), end = coordinate({ x: Math.max(...xs) + margin, y: Math.max(...ys) + margin });
      const x1 = Math.min(998, start.x, end.x), y1 = Math.min(998, start.y, end.y), x2 = Math.max(x1 + 1, start.x, end.x), y2 = Math.max(y1 + 1, start.y, end.y);
      return [`图1<bbox>${x1} ${y1} ${Math.min(999, x2)} ${Math.min(999, y2)}</bbox>`];
    });
  };
  const switchCanvasImage = (nextShowResult: boolean) => { if (nextShowResult && !result) return; setShowResult(nextShowResult); clearEditingState(); };
  const showToast = (message: string) => { setToast(message); if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current); toastTimerRef.current = window.setTimeout(() => setToast(""), 3200); };
  const downloadResult = () => { if (!result) return; const link = document.createElement("a"); link.href = result; link.download = `画梦结果-${new Date().toISOString().slice(0, 10)}.${advanced.outputFormat}`; document.body.appendChild(link); link.click(); link.remove(); showToast("已开始下载结果图，可在浏览器下载列表查看。"); };
  const downloadLayer = (layer: SeparatedLayer) => { const link = document.createElement("a"); link.href = layer.image; link.download = `${layer.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-")}.png`; document.body.appendChild(link); link.click(); link.remove(); showToast(`已开始下载「${layer.name}」。`); };
  const updateLayer = (id: string, changes: Partial<SeparatedLayer>) => setLayers(current => current.map(layer => layer.id === id ? { ...layer, ...changes } : layer));
  const separateLayers = async () => {
    if (!source || separating) return;
    const requestId = ++layerRequestRef.current;
    if (layerProgressTimerRef.current) window.clearInterval(layerProgressTimerRef.current);
    setSeparating(true); setLayerError(""); setLayerProgress(8); setLayerStage(layers.length ? "正在按最新提示词重新分离" : "正在上传原图");
    const progressTimer = window.setInterval(() => setLayerProgress(current => { const next = Math.min(88, current + (current < 35 ? 13 : current < 65 ? 7 : 3)); setLayerStage(next < 35 ? "正在上传原图" : next < 65 ? "正在识别主体与场景" : "正在生成可编辑图层"); return next; }), 650);
    layerProgressTimerRef.current = progressTimer;
    try {
      const response = await fetch("/api/layers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: source, prompt: prompt.trim() || undefined, coordinateTokens: buildCoordinateTokens(), markInstructions }) });
      const responseText = await response.text();
      let data: { layers?: Array<{ id?: string; name?: string; image?: string; kind?: string; zIndex?: number; boundingBox?: LayerBounds }>; error?: string };
      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        throw new Error(`工作台接口返回了非 JSON 页面（HTTP ${response.status}）。请检查 Nginx 是否将 /api/ 代理到 127.0.0.1:3000。`);
      }
      if (requestId !== layerRequestRef.current) return;
      if (!response.ok || !data.layers?.length) throw new Error(data.error || "图层分离服务未返回可用图层");
      const nextLayers = data.layers.filter(layer => layer.image).map((layer, index) => { const zIndex = Number.isFinite(layer.zIndex) ? layer.zIndex! : index; const name = layer.name || (zIndex === 0 ? "背景底图" : `图层 ${zIndex}`); return { id: layer.id || crypto.randomUUID(), name, image: layer.image!, kind: layer.kind, zIndex, boundingBox: layer.boundingBox, group: zIndex === 0 ? "背景" : inferLayerGroup(name, layer.kind), visible: true, opacity: 100, order: zIndex }; }).sort((a, b) => a.order - b.order);
      if (!nextLayers.length) throw new Error("图层分离服务未返回包含图片的数据");
      layerImagesRef.current.clear(); setLayers(nextLayers); setSelectedLayerId(nextLayers[0].id); setWorkspace("layers"); setLayerProgress(100); setLayerStage("已完成"); showToast(`图层分离完成，已生成 ${nextLayers.length} 个图层。`);
    } catch (e) { if (requestId === layerRequestRef.current) { setLayerError(e instanceof Error ? e.message : "图层分离失败"); setLayerStage("处理失败，可重试"); } } finally { if (layerProgressTimerRef.current === progressTimer) { window.clearInterval(progressTimer); layerProgressTimerRef.current = null; } if (requestId === layerRequestRef.current) setSeparating(false); }
  };
  const reorderLayer = (targetId: string) => { if (!draggedLayerId || draggedLayerId === targetId) return; const current = [...orderedLayers], from = current.findIndex(layer => layer.id === draggedLayerId), to = current.findIndex(layer => layer.id === targetId); if (from < 0 || to < 0) return; const [moved] = current.splice(from, 1); current.splice(to, 0, moved); setLayers(current.map((layer, index) => ({ ...layer, order: index }))); setDraggedLayerId(""); };
  const markInstructions = marks.filter(mark => mark.intent.trim()).map(mark => `标记${String(mark.number).padStart(2, "0")}：${mark.intent.trim()}`).join("；");
  const optimizeLayerPrompt = () => {
    const raw = prompt.trim();
    const mentionedBird = /鹦鹉|鸟|parrot|bird/i.test(raw);
    const mentionedText = /文字|字母|文本|标题|letter|text/i.test(raw);
    const subject = mentionedBird ? "鹦鹉主体" : raw.replace(/^(请)?(分离|拆分)(图中|图片中|画面中|画面里的?)?(的)?/, "").split(/[、，,和与及]/)[0].trim() || "主要主体";
    const textLayer = mentionedText ? "所有文字与字母" : "画面中的文字与字母（如有）";
    setPrompt(`将画面拆分为独立图层：1. ${subject}；2. ${textLayer}；3. 其余背景。${subject}与${textLayer}分别保持透明背景。`);
    showToast("已优化为可编辑的多图层分离指令。");
  };
  const editSelectedLayer = () => {
    if (!selectedLayer) return;
    setEditorSource(selectedLayer.image); setEditorSourceLabel(selectedLayer.name); setResult(""); setShowResult(false); setWorkspace("edit"); setTool("point"); clearEditingState();
    showToast(`已在交互编辑中打开「${selectedLayer.name}」。`);
  };
  const clearCurrentImage = () => {
    resetLayerResults(); setSource(""); setEditorSource(""); setEditorSourceLabel("原图"); setResult(""); setShowResult(false); setPrompt(""); setError(""); setWorkspace("edit"); setTool("point"); clearEditingState();
  };
  const formatDebug = (value: unknown) => JSON.stringify(value, null, 2);
  const copyDebug = async (value: unknown) => { await navigator.clipboard.writeText(formatDebug(value)); };
  const summarizeClientRequest = (request: Record<string, unknown>) => ({
    ...request,
    image: typeof request.image === "string" ? `<图片数据：${request.image.length.toLocaleString()} 个字符>` : request.image,
  });
  const generate = async () => {
    if (!canvasSource || !prompt.trim()) return; setBusy(true); setError("");
    const clientRequest = { prompt, ratio, outputWidth, outputHeight, imageArea, resolution, advanced, interactionMode, image: interactionMode === "coordinate" ? canvasSource : exportMarkedImage(), coordinateTokens: interactionMode === "coordinate" ? buildCoordinateTokens() : [], markInstructions, debug: debugEnabled };
    const clientDebugRequest = summarizeClientRequest(clientRequest);
    if (debugEnabled) setDebugTrace({ clientRequest: clientDebugRequest });
    try {
      const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clientRequest) });
      const responseText = await res.text();
      let data: { image?: string; error?: string; debug?: { arkRequest?: unknown; arkResponse?: unknown } };
      try { data = JSON.parse(responseText); } catch { throw new Error(`服务端返回了无法解析的响应（HTTP ${res.status}）`); }
      if (debugEnabled) { const { debug, ...appResponse } = data; setDebugTrace({ clientRequest: clientDebugRequest, arkRequest: debug?.arkRequest, arkResponse: debug?.arkResponse, appResponse: { ...appResponse, image: data.image ? `<图片数据：${data.image.length.toLocaleString()} 个字符>` : undefined } }); }
      if (!res.ok) throw new Error(data.error || `生成失败（HTTP ${res.status}）`);
      if (!data.image) throw new Error("服务端未返回生成图片");
      setResult(data.image); setShowResult(true); clearEditingState();
    }
    catch (e) { setError(e instanceof TypeError ? "网络连接中断，请检查本地服务是否仍在运行后重试。" : e instanceof Error ? e.message : "生成失败"); } finally { setBusy(false); }
  };

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand-mark">梦</div>{["主页", "图片生成", "视频生成", "模型广场", "智能编辑", "素材库"].map((label, i) => <button key={label} className={i === 1 ? "side-btn active" : "side-btn"} aria-label={label} title={label}><Icon>{["⌂", "▧", "◉", "▣", "↗", "▱"][i]}</Icon></button>)}<div className="side-sep" /><button className="side-btn" title="创意工具">✦</button><button className="side-btn" title="工作流">⌘</button><button className="side-btn bottom" title="文件夹">▱</button></aside>
    <header className="topbar"><div className="logo"><span className="logo-orb">梦</span> 豆包画梦工作室</div><div className="top-actions"><button>？ 帮助</button></div></header>
    <section className="history-page"><div className="history-copy"><span className="date">2026-07-14 12:41:37</span><p>使用标注区域对图像进行精准编辑，保持未标注区域与原图完全一致。</p><div className="tags"><span>豆包画梦 5.0 专业版</span><span>参考图片</span><span>高级参数 ⓘ</span></div></div><div className="gallery-card">{result ? <img src={result} alt="最新生成结果" /> : <div className="gallery-placeholder">生成结果将在这里显示</div>}<div className="card-actions"><button onClick={() => switchCanvasImage(true)} disabled={!result}>⌁ 重新编辑</button><button onClick={generate} disabled={!canvasSource || !prompt.trim() || busy}>↻ 再次生成</button>{result && <button onClick={downloadResult}>↓ 下载</button>}</div></div></section>
    <aside className="explore"><div className="explore-tabs"><b>发现</b><span>历史记录</span></div><div className="masonry">{Array.from({ length: 12 }).map((_, i) => <div key={i} className={`tile t${i % 6}`}>画梦<br/><small>视觉灵感 {i + 1}</small></div>)}</div></aside>

    <div className="modal-backdrop"><section className="draw-modal" aria-label="画板编辑器"><div className="modal-title"><div className="workspace-tabs"><button className={workspace === "edit" ? "selected" : ""} onClick={() => switchWorkspace("edit")}>交互编辑</button><button className={workspace === "layers" ? "selected" : ""} onClick={() => switchWorkspace("layers")}>图层分离</button></div><div className="result-actions">{workspace === "edit" && result && <><button className={!showResult ? "selected" : ""} onClick={() => switchCanvasImage(false)}>原图</button><button className={showResult ? "selected" : ""} onClick={() => switchCanvasImage(true)}>生成结果</button><button className="download-result" onClick={downloadResult}>↓ 下载结果图</button></>}<button onClick={clearCurrentImage} aria-label="清空当前图片" title="清空当前图片">×</button></div></div>
      <div className="editor-stage" ref={stageRef}>{!canvasSource && <label className="upload-empty"><span>＋</span><b>上传图片开始创作</b><small>支持 PNG、JPG 或 WEBP</small><input type="file" accept="image/*" onChange={upload} /></label>}<canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
        <div className="tools">{visibleTools.map(t => <button key={t} className={tool === t ? "selected tip" : "tip"} data-tip={TOOL_INFO[t].label} onClick={() => setTool(t)} aria-label={TOOL_INFO[t].label}><Icon>{TOOL_INFO[t].icon}</Icon></button>)}</div>
        <div className="history-tools"><button className="tip" data-tip="撤销" onClick={undo} disabled={!marks.length} aria-label="撤销">↶</button><button className="tip" data-tip="重做" onClick={redo} disabled={!redoStack.length} aria-label="重做">↷</button></div>
        <div className="zoom-tools"><button onClick={() => setZoom(z => Math.min(3, z + .1))} aria-label="放大">＋</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.max(.3, z - .1))} aria-label="缩小">−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="适应画布">⌗</button></div>
        {(tool === "brush" || tool === "rect" || tool === "arrow" || tool === "point") && <div className="brush-panel"><div className="panel-mini-title">{TOOL_INFO[tool].label}</div><div className="swatches">{COLORS.map(c => <button key={c} onClick={() => setColor(c)} className={c === color ? "picked" : ""} style={{ background: c }} aria-label={`选择颜色 ${c}`} />)}</div><label>透明度<input type="range" min=".15" max="1" step=".05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /><span>{Math.round(opacity * 100)}%</span></label>{tool === "brush" && <label>画笔大小<input type="range" min="3" max="40" value={brushWidth} onChange={e => setBrushWidth(Number(e.target.value))} /><span>{brushWidth}px</span></label>}</div>}
        {marks.length > 0 && <aside className="mark-intent-panel"><header><b>{workspace === "layers" ? "分离引导" : "标记意图"}</b><small>{workspace === "layers" ? "框选或涂抹会引导图层提取" : "会随本次生成一并发送"}</small></header>{marks.map(mark => <div className="mark-intent-card" key={mark.id}><span>{mark.number}</span><input value={mark.intent} onChange={e => updateMark(mark.id, { intent: e.target.value })} placeholder={workspace === "layers" ? `描述要提取的主体或图层 ${mark.number}` : `描述标记${String(mark.number).padStart(2, "0")}要如何修改`} /><button onClick={() => removeMark(mark.id)} aria-label={`删除标记${mark.number}`}>×</button></div>)}</aside>}
        {workspace === "layers" && <aside className="layer-panel"><header><div><b>图层分离</b><small>可拖动排序，画布实时合成预览</small></div><button className="layer-run" onClick={separateLayers} disabled={!source || separating}>{separating ? "分离中…" : layers.length ? "重新分离" : "开始分离"}</button></header><div className="layer-mark-tools"><b>手动引导</b><small>先选工具，再在图片中央点击或拖动</small><div><button className={tool === "point" ? "selected" : ""} onClick={() => setTool("point")}>◎ 点标记</button><button className={tool === "rect" ? "selected" : ""} onClick={() => setTool("rect")}>□ 框选</button><button className={tool === "brush" ? "selected" : ""} onClick={() => setTool("brush")}>⌁ 涂抹</button></div><span>已添加 {marks.length} 个引导标记</span></div>{(separating || layerProgress > 0) && <div className="layer-progress"><div><span>{layerStage}</span><b>{layerProgress}%</b></div><i><em style={{ width: `${layerProgress}%` }} /></i></div>}{layerError && <div className="layer-error"><span>{layerError}</span><button onClick={separateLayers}>重试</button></div>}{!layers.length && !layerError && !separating && <div className="layer-empty"><span>✦</span><b>还没有分离结果</b><small>框选、点选或涂抹后，填写分离引导并开始处理。</small></div>}{layers.length > 0 && <div className="layer-list">{LAYER_GROUPS.map(group => { const groupLayers = orderedLayers.filter(layer => layer.group === group); return groupLayers.length ? <section className="layer-group" key={group}><h3>{group}<span>{groupLayers.length}</span></h3>{groupLayers.map(layer => <article key={layer.id} draggable onDragStart={() => setDraggedLayerId(layer.id)} onDragOver={event => event.preventDefault()} onDrop={() => reorderLayer(layer.id)} className={layer.id === selectedLayerId ? "layer-item active" : "layer-item"}><button className="layer-preview" onClick={() => setSelectedLayerId(layer.id)}><img src={layer.image} alt={layer.name} /></button><div><b>⠿ {layer.name}</b><small>{layer.kind || "独立素材"}</small><label>不透明度 <input type="range" min="0" max="100" value={layer.opacity} onChange={e => updateLayer(layer.id, { opacity: Number(e.target.value) })} /></label></div><div className="layer-actions"><button onClick={() => updateLayer(layer.id, { visible: !layer.visible })} aria-label={layer.visible ? "隐藏图层" : "显示图层"}>{layer.visible ? "◉" : "○"}</button><button onClick={() => downloadLayer(layer)} aria-label={`下载${layer.name}`}>↓</button></div></article>)}</section> : null; })}</div>}{selectedLayer && <footer><button onClick={editSelectedLayer}>在交互编辑中打开</button><button onClick={() => downloadLayer(selectedLayer)}>下载当前图层</button></footer>}</aside>}
      </div>
      <div className="prompt-panel"><div className="source-area"><label className="thumb-upload">{canvasSource ? <img src={canvasSource} alt="当前编辑图片" /> : "＋"}<input type="file" accept="image/*" onChange={upload} /></label>{debugEnabled && <button className="debug-toggle" onClick={() => setDebugOpen(open => !open)}>{debugOpen ? "收起追踪" : "请求追踪"}</button>}{debugEnabled && debugOpen && <aside className="debug-popover"><header><b>请求追踪</b><span>已隐藏 API Key</span><button onClick={() => setDebugOpen(false)} aria-label="关闭请求追踪">×</button></header>{debugTrace ? <><section><div><b>页面 → 服务端</b><button onClick={() => copyDebug(debugTrace.clientRequest)}>复制完整入参</button></div><pre>{formatDebug(debugTrace.clientRequest)}</pre></section><section><div><b>服务端 → 方舟</b><button onClick={() => copyDebug(debugTrace.arkRequest)}>复制完整入参</button></div><pre>{formatDebug(debugTrace.arkRequest)}</pre></section><section><div><b>方舟原始返回</b><button onClick={() => copyDebug(debugTrace.arkResponse)}>复制完整返回</button></div><pre>{formatDebug(debugTrace.arkResponse)}</pre></section><section><div><b>服务端 → 页面</b><button onClick={() => copyDebug(debugTrace.appResponse)}>复制完整返回</button></div><pre>{formatDebug(debugTrace.appResponse)}</pre></section></> : <p>发起一次生成后将在这里显示完整请求与返回。</p>}</aside>}</div><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={workspace === "layers" ? "描述需要分离的对象，例如：鸟和所有文字" : "描述你想生成的画面，可输入 @ 引用图片或标注"} />{workspace === "edit" && editorSource && <div className="editor-target" role="status">正在编辑：{editorSourceLabel}</div>}<div className="mode-row"><span>编辑方式</span><button className={interactionMode === "mark" ? "selected" : ""} onClick={() => switchInteractionMode("mark")}>任意标记<small>涂鸦、圈选、箭头</small></button><button className={interactionMode === "coordinate" ? "selected" : ""} onClick={() => switchInteractionMode("coordinate")}>坐标定位<small>点选、框选</small></button></div><div className="prompt-bottom"><div className="parameter-buttons"><button onClick={() => setPanel(panel === "ratio" ? null : "ratio")} className={panel === "ratio" ? "open" : ""}>▭ {ratio}</button><button onClick={() => setPanel(panel === "advanced" ? null : "advanced")} className={panel === "advanced" ? "open" : ""} aria-label="高级参数">⌘</button></div>{workspace === "layers" && <button className="prompt-optimize" onClick={optimizeLayerPrompt} disabled={!source}>✨ 优化分离提示词</button>}{interactionMode === "coordinate" && marks.length > 0 && <span className="coordinate-status">已启用 {marks.length} 个坐标定位</span>}<span className="pricing">费用说明 ⓘ</span><button className="generate" disabled={!canvasSource || !prompt.trim() || busy} onClick={generate}>{busy ? "正在生成…" : "生成"}<span>✦ 9</span></button></div>{error && <div className="error">{error}</div>}
        {panel === "ratio" && <section className="parameter-popover ratio-popover"><header><b>比例调整</b><button onClick={resetRatio}>↻ 重置</button></header><div className="parameter-body"><label className="section-label">图片比例 <span>?</span></label><div className="ratio-grid">{RATIOS.map(item => <button key={item.value} className={ratio === item.value ? "chosen" : ""} onClick={() => chooseRatio(item.value, item.width, item.height)}><i style={{ aspectRatio: `${item.w}/${item.h}` }} />{item.value}</button>)}<button className={ratio === "自定义" ? "chosen" : ""} onClick={() => setRatio("自定义")}>⌘ 自定义</button></div><label className="section-label">图片尺寸 <span>?</span></label><div className="size-inputs"><label>宽<input type="number" min="720" max="4096" value={outputWidth} onChange={e => { setOutputWidth(Number(e.target.value)); setRatio("自定义"); }} /></label><span>⇄</span><label>高<input type="number" min="720" max="4096" value={outputHeight} onChange={e => { setOutputHeight(Number(e.target.value)); setRatio("自定义"); }} /></label></div><div className="toggle-row"><span>图片面积<small>开启后按所选清晰度自动计算尺寸</small></span><button className={imageArea ? "toggle on" : "toggle"} onClick={() => setImageArea(v => !v)} aria-label="图片面积开关"><i /></button></div><select value={resolution} onChange={e => setResolution(e.target.value)} disabled={!imageArea}><option value="1K">1K</option><option value="2K">2K</option></select></div></section>}
        {panel === "advanced" && <section className="parameter-popover advanced-popover"><header><b>高级参数</b><button onClick={() => setAdvanced(DEFAULT_ADVANCED)}>↻ 重置</button></header><div className="parameter-body"><label className="field-label">输出格式 <span>?</span><select value={advanced.outputFormat} onChange={e => setAdvanced(a => ({ ...a, outputFormat: e.target.value as Advanced["outputFormat"] }))}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><div className="toggle-row"><span>添加水印 <small>图片右下角添加“AI生成”标识</small></span><button className={advanced.watermark ? "toggle on" : "toggle"} onClick={() => setAdvanced(a => ({ ...a, watermark: !a.watermark }))} aria-label="添加水印开关"><i /></button></div><p className="parameter-note">提示词优化将使用专业版支持的标准模式。</p></div></section>}
      </div>
    </section></div>{toast && <div className="download-toast" role="status"><span>✓</span>{toast}<button onClick={() => setToast("")} aria-label="关闭提示">×</button></div>}
  </main>;
}
