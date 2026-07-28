/**
 * 打免安装便携包：双击 Quickbar.exe 即可用，无需 setup
 * 输出：dist-portable/Quickbar/
 *
 * 若旧目录被占用（正在运行的 Quickbar.exe），改为原地覆盖；
 * exe 仍锁住时写出 Quickbar.exe.new 并提示先退出再替换。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "src-tauri", "target", "release");
const exeName = "quickbar.exe";
const exePath = join(releaseDir, exeName);
const outDir = join(root, "dist-portable", "Quickbar");
const outExe = join(outDir, "Quickbar.exe");

if (!existsSync(exePath)) {
  console.error(
    [
      "未找到 release 可执行文件：",
      exePath,
      "",
      "请先在 Windows 上执行：",
      "  npm run tauri:build:exe",
    ].join("\n"),
  );
  process.exit(1);
}

function isBusyError(err) {
  return (
    err
    && (err.code === "EPERM"
      || err.code === "EBUSY"
      || err.code === "EACCES"
      || err.code === "ENOTEMPTY")
  );
}

/** 尽量清空输出目录；被占用则跳过整目录删除，后续原地覆盖 */
function prepareOutDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return { cleaned: true };
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return { cleaned: true };
  } catch (err) {
    if (!isBusyError(err)) {
      throw err;
    }
    console.warn(
      "提示：dist-portable/Quickbar 被占用（多半是正在运行的 Quickbar），改为原地覆盖…",
    );
    mkdirSync(dir, { recursive: true });
    // 尽量删掉可删的子项，跳过锁住的 exe
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase() === "quickbar.exe") {
        continue;
      }
      try {
        rmSync(join(dir, name), { recursive: true, force: true });
      } catch (childErr) {
        if (!isBusyError(childErr)) {
          throw childErr;
        }
      }
    }
    return { cleaned: false };
  }
}

function copyExe(src, dest) {
  try {
    cpSync(src, dest);
    return dest;
  } catch (err) {
    if (!isBusyError(err)) {
      throw err;
    }
    const alt = `${dest}.new`;
    cpSync(src, alt);
    console.error(
      [
        "",
        "无法覆盖正在运行的 Quickbar.exe。",
        "请先退出托盘里的 Quickbar（右键托盘图标 → 退出），然后：",
        `  1) 删除或重命名：${dest}`,
        `  2) 将 ${alt}`,
        "     重命名为 Quickbar.exe",
        "或退出后再执行：npm run pack:portable",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

const { cleaned } = prepareOutDir(outDir);
copyExe(exePath, outExe);

/** 内建插件 / 市场：兼容 map 到 plugins/、旧版 _up_/、以及仓库目录 */
const resourceCandidates = [
  {
    plugins: join(releaseDir, "plugins"),
    market: join(releaseDir, "market"),
  },
  {
    plugins: join(releaseDir, "resources", "plugins"),
    market: join(releaseDir, "resources", "market"),
  },
  {
    plugins: join(releaseDir, "_up_", "plugins"),
    market: join(releaseDir, "_up_", "market"),
  },
  {
    plugins: join(root, "plugins"),
    market: join(root, "market"),
  },
];

let copied = false;
for (const c of resourceCandidates) {
  if (existsSync(c.plugins) && existsSync(c.market)) {
    cpSync(c.plugins, join(outDir, "plugins"), { recursive: true, force: true });
    cpSync(c.market, join(outDir, "market"), { recursive: true, force: true });
    copied = true;
    break;
  }
}

if (!copied) {
  console.warn("警告：未找到 plugins/market，便携包可能缺少内建插件");
}

writeFileSync(
  join(outDir, "使用说明.txt"),
  [
    "Quickbar 便携版（免安装）",
    "",
    "1. 双击 Quickbar.exe 启动（会弹出主界面，并托盘常驻）",
    "2. 默认热键 Ctrl+Space 唤起",
    "3. 配置与数据写在用户目录：%USERPROFILE%\\.quickbar\\",
    "4. 可整夹拷贝到任意盘使用，无需运行 setup",
    "5. 重新打包前请先退出正在运行的 Quickbar，否则可能无法覆盖 exe",
    "",
  ].join("\r\n"),
  "utf8",
);

console.log(`便携包已生成：${outDir}`);
if (!cleaned) {
  console.log("（原地覆盖完成；若界面仍是旧版，请完全退出后再打包一次）");
}
console.log("双击其中的 Quickbar.exe 即可使用。");
