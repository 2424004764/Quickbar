import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyThemeToDocument } from "./utils/theme";

// 首屏先按系统深浅色上色，避免闪白；随后 App 读配置覆盖
applyThemeToDocument("system");

// 屏蔽 WebView 默认右键（刷新/打印/检查等）；输入框保留系统菜单以便粘贴
document.addEventListener("contextmenu", (e) => {
  const el = e.target;
  if (
    el instanceof HTMLElement
    && el.closest("input, textarea, [contenteditable='true']")
  ) {
    return;
  }
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
