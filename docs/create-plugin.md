# 如何自己新建一款 Quickbar 应用（插件）

本文说明从零做一款可搜索、可安装、可运行的插件。写得尽量细，可按步骤照做。

> **重要现状（读完再动手）**  
> Quickbar 当前的「带界面工具」（JSON 编辑器、Base64、UUID 等）是 **宿主 React 页面**，不是靠插件目录里的 `index.js` 渲染 UI。  
> - 市场包里的 `plugin.json` / `index.js`：负责 **上架、安装、搜索命中、打开插件会话**  
> - `src/components/*Tool.jsx` + `PluginRunner.jsx`：负责 **真正的界面**  
> 若只拷贝一个含 `plugin.json` 的目录并安装，一般能搜到、能打开，但界面只会显示占位提示：「后续可为该插件接入独立界面」。要完整工具页，必须同时改宿主前端（见下文路径 B）。

### JS 运行时（当前）

自己写的应用 **没有独立的插件 JS 引擎 / 沙箱**。业务与 UI 代码跑在宿主里：

| 层级 | 实际环境 |
|------|----------|
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React + Vite |
| 浏览器内核 | 系统 WebView（Windows 为 **WebView2** / Chromium） |
| 插件包 `index.js` | **不**作为 UI 运行时执行；多为元信息/入口声明，供安装与打开会话用 |

因此：

- 写界面与逻辑 → 改仓库 `src/components`、`src/utils`（开发时 Node 仅用于 Vite 构建/调试）
- 用户运行时看到的是 WebView 里的宿主前端，不是 Node、也不是每个插件单独开 WebView
- 「完整插件 WebView 沙箱」尚未实现（见 README「本阶段不做」）；将来若有，会另写文档

---

## 1. 概念与目录

| 概念 | 路径 / 含义 |
|------|-------------|
| 插件 ID | 全局唯一英文短名，如 `my-case-tool`（建议小写 + 连字符） |
| 市场包 | 仓库 `market/packages/<id>/`，或用户侧 `~/.quickbar/market/packages/<id>/` |
| 市场目录 | `market/catalog.json`（开发仓库）或 `~/.quickbar/market/catalog.json`（本机） |
| 已安装插件 | `~/.quickbar/plugins/<id>/` |
| 内建插件 | 仓库 `plugins/`（如 `market` 入口本身） |
| 宿主 UI | `src/components/XxxTool.jsx`，在 `PluginRunner.jsx` 按 `pluginId` 挂载 |
| 纯逻辑 | 可放 `src/utils/*.js`，由 Tool 组件引用 |
| JS 运行时 | 宿主 React（Tauri WebView）；非插件独立运行时，见上文 |

Windows 用户目录示例：

```text
C:\Users\<你>\.quickbar\
  config.json
  plugins\          ← 已安装
  market\
    catalog.json
    packages\       ← 本地市场上架包
```

开发仓库里改 `market/` 后，启动时会把种子 catalog/包同步进用户目录（已有条目会合并新包；以实际同步逻辑为准）。改完建议 **重启 Quickbar** 或在市场页点「刷新」。

---

## 2. 选一条路径

### 路径 A：只上架 / 安装（无自定义界面）

适合：先占坑、做搜索入口、以后再写 UI。

结果：可在市场安装、可搜索打开，打开后是占位页。

### 路径 B：完整工具（推荐，与现有 JSON/Base64 一致）

适合：要做真正的小工具界面。

需要同时做：

1. 市场包 + `catalog.json`（同路径 A）  
2. 宿主 `XxxTool.jsx`（及可选 `utils`）  
3. 在 `PluginRunner.jsx` 注册 `pluginId`  

### 路径 C：本机临时安装（不改仓库）

适合：只在自己电脑试装别人的包，或本地调试安装流程。

应用市场 →「选目录」或「选 Zip」→ 装到 `~/.quickbar/plugins/<id>/`。  
**没有宿主 UI 时同样只有占位页。**

### 路径 D：云端投稿（可选）

需配置 `marketBaseUrl`，市场页「投稿上架」上传 zip，管理员审核后进远程 catalog。见 README「云端市场」。

---

## 3. `plugin.json` 字段说明

每个插件目录必须有 `plugin.json`（UTF-8）。

### 3.1 完整示例

```json
{
  "id": "my-case-tool",
  "name": "大小写转换",
  "version": "0.1.0",
  "author": "your-name",
  "description": "一键转大写 / 小写 / 标题格式",
  "entrypoint": "index.js",
  "features": ["search", "action"],
  "commands": [
    { "code": "case", "label": "大小写转换" }
  ],
  "market": {
    "category": "dev",
    "icon": "icon.png"
  }
}
```

### 3.2 字段表

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一 ID，与目录名、catalog 条目、`PluginRunner` 分支一致 |
| `name` | 是 | 展示名（中文可） |
| `version` | 是 | 语义化版本，如 `0.1.0` |
| `author` | 否 | 作者 |
| `description` | 否 | 市场列表副标题、搜索文案 |
| `entrypoint` | 建议 | 入口脚本，现有包多为 `index.js`（可仅导出 meta） |
| `features` | 建议 | 含 `search` / `action` 才会出现在聚合搜索里 |
| `commands` | 建议 | 搜索入口；`code` 短码，`label` 列表标题 |
| `market.category` | 否 | 分类，现有多用 `dev` |
| `market.icon` | 否 | 相对插件目录的图标文件名（可选） |

### 3.3 ID 命名建议

- 用英文：`text-case`、`qr-code`  
- 不要空格、不要中文  
- 不要与已有包冲突（见 `market/catalog.json` 与 `market/packages/`）  
- 改 ID 等于新产品：旧安装目录不会自动迁移  

---

## 4. 路径 A：最小可安装包

### 4.1 建目录

在仓库（开发上架）：

```text
market/packages/my-case-tool/
  plugin.json
  index.js
```

或仅本机：

```text
%USERPROFILE%\.quickbar\market\packages\my-case-tool\
  plugin.json
  index.js
```

### 4.2 `index.js`（可极简）

现有宿主工具包通常只占位，界面不在这里画：

```js
/** 大小写转换（界面由宿主 MyCaseTool 承载；未接宿主时仅占位） */
export const meta = { id: "my-case-tool" };
```

### 4.3 写入 `catalog.json`

在 `market/catalog.json` 数组中增加一项（注意 JSON 逗号）：

```json
{
  "id": "my-case-tool",
  "name": "大小写转换",
  "version": "0.1.0",
  "author": "your-name",
  "description": "一键转大写 / 小写 / 标题格式",
  "category": "dev",
  "source": "local:packages/my-case-tool",
  "installed": false,
  "installedVersion": null
}
```

要点：

- `id` 与包目录、`plugin.json` 的 `id` 一致  
- `source` 固定形态：`local:packages/<id>`（相对 market 根）  
- 本机用户目录同样改 `~/.quickbar/market/catalog.json`  

### 4.4 验证安装

1. 重启 Quickbar，或打开应用市场点「刷新」  
2. 在「全部」里应看到新条目  
3. 点「安装」→ 目录出现在 `~/.quickbar/plugins/my-case-tool/`  
4. 搜索插件名或 command label，Enter 打开  
5. **未做路径 B 时**：看到占位提示文案，属正常  

也可用市场页 **选目录**：直接指向 `my-case-tool` 文件夹安装（可不经 catalog）。

### 4.5 打 Zip（可选）

Zip **根下**就要有 `plugin.json`（不要多包一层无用目录，或保证 zip 内任意层级能扫到 `plugin.json`——以当前安装器行为为准，建议根目录即插件根）：

```text
my-case-tool.zip
  plugin.json
  index.js
```

市场页「选 Zip」安装。投稿上架时也是上传这类 zip。

---

## 5. 路径 B：完整宿主界面（详细步骤）

以「大小写转换」为例，对照现有 `uuid-gen` / `base64-codec`。

### 5.1 先做路径 A

保证 `market/packages/my-case-tool/` + `catalog.json` 已就绪，ID 定为 `my-case-tool`。

### 5.2（可选）纯函数放到 `src/utils`

例如 `src/utils/textCase.js`：

```js
/**
 * @param {string} text
 * @param {"upper"|"lower"|"title"} mode
 */
export function transformCase(text, mode) {
  const s = String(text ?? "");
  if (mode === "upper") return s.toUpperCase();
  if (mode === "lower") return s.toLowerCase();
  return s.replace(/\w\S*/g, (w) =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );
}
```

约定：业务说明注释用中文；标识符英文。有单测可放同目录 `*.test.js`（若项目已接测试）。

### 5.3 新建 Tool 组件

新建 `src/components/MyCaseTool.jsx`。可参考 `UuidTool.jsx` / `Base64Tool.jsx`：

- 根节点常用 class：`pr-codec`、`pr-body` 内布局（见 `styles/global.css` 里 `.pr-*`）  
- 可交互控件加 `data-no-drag`，避免拖窗误触  
- 按钮用现有 `btn` / `btn primary`  
- 不要引入 TypeScript；类型用 JSDoc  

骨架示例：

```jsx
/**
 * 大小写转换工具
 */
import { useState } from "react";
import { transformCase } from "../utils/textCase";

export function MyCaseTool() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState(/** @type {"upper"|"lower"|"title"} */ ("upper"));

  const out = transformCase(text, mode);

  return (
    <div className="pr-codec">
      <div className="pr-codec-actions">
        <button
          type="button"
          className={["btn", mode === "upper" ? "primary" : ""].join(" ")}
          onClick={() => setMode("upper")}
        >
          大写
        </button>
        <button
          type="button"
          className={["btn", mode === "lower" ? "primary" : ""].join(" ")}
          onClick={() => setMode("lower")}
        >
          小写
        </button>
        <button
          type="button"
          className={["btn", mode === "title" ? "primary" : ""].join(" ")}
          onClick={() => setMode("title")}
        >
          标题格式
        </button>
      </div>
      <textarea
        className="pr-codec-area"
        data-no-drag
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入文本…"
      />
      <textarea
        className="pr-codec-area"
        data-no-drag
        readOnly
        value={out}
        placeholder="结果"
      />
    </div>
  );
}
```

（具体 class 以现有 Tool 为准，可从 `Base64Tool.jsx` 复制布局再改。）

### 5.4 在 `PluginRunner.jsx` 注册

1. 顶部增加：

```js
import { MyCaseTool } from "./MyCaseTool";
```

2. 在 `pr-body` 的条件链中增加（`pluginId` 必须等于 `plugin.json` 的 `id`）：

```jsx
) : pluginId === "my-case-tool" ? (
  <MyCaseTool />
```

注意挂在合适位置，保持三元链完整，不要漏 `)`。

### 5.5 开发联调

```powershell
cd C:\dev\quickbar
npm run tauri dev
```

1. 热键唤起 → 应用市场 → 安装「大小写转换」（若尚未安装）  
2. 搜索「大小写」或 command label → Enter  
3. 应进入你的 `MyCaseTool`，而不是占位页  
4. 试「分离窗口」/ `Ctrl+D`：独立窗应同样渲染该 Tool  

前端热更新通常够用；若市场包/同步异常，重启一次。

### 5.6 自检清单（路径 B）

- [ ] `id` 在 catalog、`plugin.json`、目录名、`PluginRunner` 四处一致  
- [ ] `features` 含 `search`，能被全局搜索命中  
- [ ] 安装后 `~/.quickbar/plugins/<id>/plugin.json` 存在  
- [ ] 打开后是真实 UI，不是「后续接入独立界面」  
- [ ] Esc：有搜索内容先清空；空则隐藏（主窗行为）  
- [ ] 分离窗可置顶 / 关闭  

---

## 6. 仅本机安装（路径 C）细说

不改 git 仓库时：

1. 本地建文件夹，放入合法 `plugin.json`（+ 可选 `index.js`）  
2. Quickbar → 应用市场 → **选目录** → 选该文件夹  
   或打成 zip → **选 Zip**  
3. 安装成功后出现在「已安装」  

卸载：市场「已安装」里点卸载（内建插件不能卸）。

若还要完整 UI，仍须走路径 B 改宿主，并保证本机安装的 `id` 与 `PluginRunner` 分支一致。

---

## 7. 搜索如何命中你的插件

宿主会聚合插件名、描述、id、commands 的 label/code（小写连续子串，不区分大小写）。因此：

- `name` / `description` 写清楚常用关键词  
- `commands[].label` 尽量好搜  
- 不必做跳跃模糊匹配（已改为连续子串）  

打开动作：命中后由前端 `open_plugin`，进入 `PluginRunner`。

---

## 8. 上架到开发仓库市场（给别人用）

发版/给同事用开发包时：

1. 提交 `market/packages/<id>/`  
2. 提交 `market/catalog.json` 新条目  
3. 若做了路径 B：提交 `src/components/*Tool.jsx`、`PluginRunner.jsx`、可选 `src/utils`  
4. 对方更新代码或安装包后：市场刷新 → 安装  

**注意：** 只发 market 包、不发宿主改动的安装包时，对方只能装到占位页。完整工具必须随 Quickbar 前端一起发布。

免费应用、添加无数量限制是产品侧承诺；技术上本机 `plugins` 目录可装多款，无需登录。

---

## 9. 云端投稿（路径 D）摘要

1. `~/.quickbar/config.json` 设置 `marketBaseUrl`（如 `http://127.0.0.1:8787`）  
2. 打好 zip（含 `plugin.json`）  
3. 市场页「投稿上架」  
4. 管理员审核通过后进远程 catalog  
5. 远程不可用时回退本地 catalog  

详细见仓库 README「云端市场」与 `quickbar_market` 服务文档。

---

## 10. 常见问题

### 市场里看不到新包

- catalog JSON 是否合法（逗号、括号）  
- `source` 是否为 `local:packages/<id>` 且目录存在  
- 是否刷新/重启  
- 是否改错了仓库 `market/` 而用户目录未同步（可直接查 `~/.quickbar/market/`）  

### 能安装但打开是占位页

未在 `PluginRunner.jsx` 注册对应 `pluginId`，或 ID 不一致。走路径 B。

### 搜索不到

- 未安装且未进搜索源  
- `features` 缺少 `search`  
- 关键词与 name/description/label 对不上（需连续包含）  

### 安装失败

- `plugin.json` 缺 `id`/`name`/`version`  
- zip 结构不对，找不到 `plugin.json`  
- 同 id 冲突或目录权限问题  

### 改了市场包但界面还是旧的

UI 在宿主 React 里；改 `*Tool.jsx` 才变界面。市场包版本号主要给列表/安装信息用。

### 开发环境如何清空重测

- 最近使用：DevTools Console 执行  
  `localStorage.removeItem("quickbar.recent.v1"); location.reload()`  
- 整机数据：退出后删除 `%USERPROFILE%\.quickbar`（会清配置与已装插件）  

---

## 11. 推荐对照样板

| 目标 | 对照 |
|------|------|
| 最小市场包 | `market/packages/base64-codec/` |
| 简单编解码 UI | `src/components/Base64Tool.jsx` |
| 生成类 UI | `src/components/UuidTool.jsx` |
| 复杂编辑器 | `src/components/JsonFormatTool.jsx` |
| 注册表 | `src/components/PluginRunner.jsx` |
| catalog 条目 | `market/catalog.json` |
| 安装/投稿 UI | `src/components/MarketPanel.jsx` |

---

## 12. 一页纸流程（完整工具）

```text
1. 定 id：my-case-tool
2. 写 market/packages/my-case-tool/{plugin.json,index.js}
3. 改 market/catalog.json 增加条目
4. 写 src/utils/...（可选）+ src/components/MyCaseTool.jsx
5. PluginRunner.jsx import + pluginId 分支
6. npm run tauri dev → 市场安装 → 搜索打开 → 验收分离窗
7. 提交仓库；需要时打安装包发给别人
```

按上述做完，即完成「自己新建一款应用」的完整闭环。若只做市场占位，做到第 3 步并安装即可。
