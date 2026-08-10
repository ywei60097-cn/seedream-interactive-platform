# 豆包画梦工作室 Demo

基于方舟 `Seedream 5.0 Pro` 的图片交互编辑演示项目。它提供了类似画板的可视化标注体验，并支持将编辑请求安全地转发到方舟 API。

## 运行环境

- Node.js `>= 22.13.0`
- npm（随 Node.js 安装）
- 已开通图像生成服务的火山方舟 API Key

## 配置密钥

在项目根目录创建 `.env.local`，填写自己的方舟 API Key。密钥仅由服务端读取，不能提交到代码仓库，也不要放进前端代码。

```bash
ARK_API_KEY=你的方舟_API_Key
ARK_MODEL_ID=doubao-seedream-5-0-pro-260628
```

`ARK_MODEL_ID` 可不填，默认使用 `doubao-seedream-5-0-pro-260628`。

图层分离是 Seedream 5.0 Pro 的独立能力，使用同一个 ImageGenerations 地址并通过 `layer_decomposition: true` 开启；只要已配置上方的 `ARK_API_KEY` 和 5.0 Pro 模型即可使用。若需覆盖默认地址、密钥或模型，可选填：

```bash
LAYER_SEPARATION_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/images/generations
LAYER_SEPARATION_API_KEY=图层分离服务密钥 # 与方舟相同时可省略
LAYER_SEPARATION_MODEL=服务指定模型 # 如接口不要求模型可留空
```

## 启动

```bash
npm install
npm run dev
```

启动完成后访问终端显示的本地地址（通常是 `http://localhost:3000`）。

常用校验命令：

```bash
npm run build
npm test
npm run lint
```

## 已实现能力

- 上传图片并在画板中缩放、拖拽和居中查看。
- 两种可手动切换的交互编辑方式：
  - **任意标记**：涂鸦、圈选、箭头等手绘标记会叠加到图片后发送给模型。
  - **坐标定位**：点选和框选会转换为相对坐标提示，原图与坐标描述一同发送给模型。
- 编辑指令输入、参考图入口、比例与分辨率设置，以及 Seedream 5.0 Pro 支持的高级参数。
- 使用服务端接口调用方舟，API Key 不会下发到浏览器。
- 调试追踪：本地环境或 URL 附带 `?debug=1` 时，可在原图缩略图旁打开面板，查看页面、服务端和方舟之间的请求/响应；API Key 与大体积 Base64 图片数据始终隐藏。
- 生成结果预览和下载。
- **图层分离工作区**：以 `layer_decomposition: true` 调用 Seedream 5.0 Pro，输出 1 张底图和最多 16 张透明 PNG 图层；支持点选、框选、涂抹与文字引导、正确的图层位置还原、排序、显示/隐藏、不透明度、单图下载，以及将选中图层送回交互编辑继续处理。

## 接口实现说明

浏览器请求 `/api/generate`，由服务端读取 `ARK_API_KEY` 并调用方舟图像生成接口。前端不会保存或展示密钥。

图层分离请求由 `/api/layers` 转发。请求为单张 `image`、`layer_decomposition: true`、可选 `prompt`、`size: auto` 与 `output_format: jpeg`；不发送 `sequential_image_generation`、`sequential_image_generation_options`、`max_images` 或 `stream`。响应以 `data[0]` 为底图（`z_index: 0`），后续图层使用 `z_index` 和 `bounding_box.normalized` 恢复到正确位置。

- 任意标记模式仅发送带标记的图片，避免原图和标记图相互干扰。
- 坐标定位模式仅发送原图，并将画板标记转换为模型可理解的点/框坐标提示。
- 图片尺寸会在服务端校验，确保总像素数符合 Seedream 5.0 Pro 的范围。

## 本地问题排查

- 出现“服务端尚未配置 ARK_API_KEY”：确认项目根目录存在 `.env.local`，并在修改后重启 `npm run dev`。
- 出现“网络连接中断”：先确认启动命令所在终端没有退出，再尝试较小的图片；输入图片超过约 18MB 时接口会返回明确提示。
- 若只有某台电脑无法请求方舟，请检查该电脑能否访问 `ark.cn-beijing.volces.com`，以及系统代理或 VPN 是否拦截了 Node.js 进程。

## 项目结构

- `app/page.tsx`：画板与交互界面。
- `app/api/generate/route.ts`：服务端方舟请求、参数校验和调试追踪。
- `app/editor.css`：编辑器样式。
- `.env.example`：环境变量模板，不含真实密钥。
