# CLAUDE.md — Quickbar 开发约定

给 AI / 协作者的项目规则。改代码前先读本节。

## 项目一句话

Tauri 2 + React + Vite 的本机启动器。耗时逻辑在 Rust，UI 在宿主 React（WebView2）。插件 `index.js` **不**渲染界面。

## 硬性规则（踩过坑）

### 1. 禁止同步阻塞 UI 的 Tauri 命令

同步 `#[tauri::command]` 跑在主线程。`pg_dump`、扫盘、WSL 探测等一久，窗口就会「未响应」。

**凡是可能超过 ~100ms 的 I/O / 子进程，必须：**

```rust
#[tauri::command]
pub async fn foo(...) -> Result<..., String> {
    tauri::async_runtime::spawn_blocking(move || foo_blocking(...))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}
```

已照此改过：`disk_analyze`、`pg_migrate`、`pg_test_connection`、`pg_list_schemas`、`pg_detect_tools`。

新增同类命令时照抄，不要再写同步版。

### 2. 失焦隐藏有两条路径，必须一起关

| 路径 | 位置 | 开关 |
|------|------|------|
| Rust | `lib.rs` `WindowEvent::Focused(false)` | `set_blur_hide_enabled` / `allow_blur_hide` |
| 前端 | `App.jsx` `onFocusChanged` | `isWindowDragBlurSuppressed()` |

只关 Rust、不关前端 → 文件对话框仍会把主窗藏掉。

打开系统对话框统一用：

```js
import { runWithBlurHideSuspended } from "../utils/windowDrag";
await runWithBlurHideSuspended(() => open({ directory: true, ... }));
```

该函数会：await 后端关失焦 → 执行 → 必要时 `show()` 自愈 → 延迟再开失焦。

长时间对照其他窗口操作（迁移、扫盘）用「钉住窗口」：`setBlurHidePinned(true)`。

### 3. 热更新边界

| 改动 | 能否热更新 |
|------|------------|
| `src/**/*.{js,jsx,css}`、`index.html` | 可以（Vite HMR） |
| `src-tauri/src/**/*.rs`、`Cargo.toml`、图标 | **不行**，需重启 `npm run tauri:dev` |

告诉用户「重启」时说清楚是哪一类。

### 4. 应用图标

- 源图：`public/logo.png`
- 生成：`npm run tauri -- icon public/logo.png`
- 图标嵌入 exe，**必须重新编译**；若 `quickbar.exe` 正在跑会 link 失败 → 先结束进程再 `cargo build` / `tauri:dev`
- WebView favicon：`index.html` 用 `/logo.png`，不要用默认 `vite.svg`

### 5. 分离窗口会丢 React 状态

`分离窗口` = 新开 WebView，组件重新挂载。长时间任务（扫盘）状态要放 **Rust 全局**，新窗口 `disk_scan_state` 接管；卸载时不要自动 `cancel`。

完成结果用事件广播（如 `quickbar://disk-usage-done`），不要只依赖发起窗的 Promise。

## 插件 / 系统工具

完整工具需要：

1. `plugins/<id>/`（内建可搜）+ `market/packages/<id>/` + `catalog.json`
2. `src/components/XxxTool.jsx` + `PluginRunner.jsx` 分支
3. 若需本机能力：`src-tauri` 模块 + `lib.rs` 注册 + `src/pluginApi/api.js`

仅拷贝 `plugin.json` 只能搜到占位页。详见 `docs/create-plugin.md`。

## PostgreSQL 迁移（pg-migrate）

- 用本机 / WSL 的 `pg_dump` + `psql`，不要用 Rust 重写 dump
- 自动找工具顺序：手动 bin → Quickbar `postgres/bin` → PATH → `Program Files\PostgreSQL\*\bin` → **WSL**
- Navicat **没有** `psql.exe` / `pg_dump.exe`
- WSL：路径转 `/mnt/c/...`；`localhost`/`127.0.0.1` 换成 Windows 宿主机 IP
- 源 / 目标 schema **分开指定**；名不同则改写 dump SQL
- **`--clean` 禁止与 `--data-only` 同用**（Rust 与 UI 都要挡）
- Schema 列表用 `<select>`，不要用会按输入过滤的 `datalist`
- 密码本机 DPAPI 加密，勿提交 vault / 明文连接

## 磁盘占用（disk-usage）

- 扫描必须 async + 后台线程；边扫边推进度事件；按 size 降序
- 热力图面积 ∝ 大小；可下钻；面包屑 / 「上级」返回
- 显示卷容量：总量 / 已用 / 剩余（`GetDiskFreeSpaceEx`）

## UI / 样式

- 错误/成功条要高对比（浅色主题尤其重要）；不要用低对比淡粉/淡绿字
- 首页磁贴标题最多两行，超出才省略（`-webkit-line-clamp: 2`）
- 列表操作按钮（测试/编辑/删除）禁止被长文案挤窄；`flex: 0 0 auto` + `white-space: nowrap`
- 前端设计：沿用现有 `--qb-*` 变量与组件类名，勿另起一套

## Git

- **只有用户明确要求时才 commit / push**
- 勿改 git config；勿 `--force` 到 main/master（除非用户明确要求）
- 提交说明写「为什么」，1–2 句

## 常用命令

```bash
npm run tauri:dev      # 开发（改 Rust 需重启）
npm run test           # 前端 vitest
npm run test:rust      # cargo test
npm run tauri -- icon public/logo.png
```

Windows 开发目录请放在本机盘（如 `C:\dev\quickbar`），不要在 WSL 挂载路径上跑 Windows npm。
