/**
 * JSON this 表达式过滤与树路径工具（纯函数，供工具 UI 与单测共用）
 */

/**
 * 对 JSON 根对象执行 this 表达式过滤
 * 示例：.key.subkey、[0][1]、.map(x=>x.val)
 * @param {unknown} data
 * @param {string} expr
 */
export function applyJsonFilter(data, expr) {
  const raw = String(expr || "").trim();
  if (!raw) {
    return data;
  }
  let body = raw;
  if (body.startsWith("this")) {
    body = body.slice(4);
  }
  if (body && !body.startsWith(".") && !body.startsWith("[")) {
    body = `.${body}`;
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (function () { return this${body}; });`);
  return fn().call(data);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyJsonResult(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value, null, 2);
}

/**
 * 收集所有可折叠路径（对象/数组）
 * @param {unknown} value
 * @param {string} [path]
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectFoldablePaths(value, path = "$", out = []) {
  if (value !== null && typeof value === "object") {
    out.push(path);
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        collectFoldablePaths(item, `${path}[${i}]`, out);
      });
    } else {
      Object.keys(value).forEach((key) => {
        collectFoldablePaths(value[key], `${path}.${key}`, out);
      });
    }
  }
  return out;
}
