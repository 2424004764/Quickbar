/**
 * 首页磁贴网格：上下左右在各分区行之间导航（类似启动器）
 * 选中键用 navKey（分区内唯一），避免同一应用出现在多行时同时高亮
 */

/** @param {{ id?: string, navKey?: string }} tile */
export function tileNavKey(tile) {
  if (!tile) {
    return "";
  }
  return String(tile.navKey || tile.id || "");
}

/**
 * @param {Array<Array<{ id?: string, navKey?: string }>>} rows
 * @returns {{ id?: string, navKey?: string } | null}
 */
export function firstHomeTile(rows) {
  for (const row of rows) {
    if (row?.length) {
      return row[0];
    }
  }
  return null;
}

/**
 * @param {Array<Array<{ id?: string, navKey?: string }>>} rows
 * @param {string} selectedKey
 * @returns {{ row: number, col: number } | null}
 */
export function findHomeTilePos(rows, selectedKey) {
  const key = String(selectedKey || "");
  const nonEmpty = (rows || []).filter((row) => row?.length);
  for (let row = 0; row < nonEmpty.length; row += 1) {
    const col = nonEmpty[row].findIndex((tile) => tileNavKey(tile) === key);
    if (col >= 0) {
      return { row, col };
    }
  }
  return null;
}

/**
 * @param {Array<Array<{ id?: string, navKey?: string }>>} rows
 * @param {string} selectedKey
 * @param {"left" | "right" | "up" | "down"} direction
 * @returns {string | null} 新选中 navKey；无可用项时 null
 */
export function moveHomeSelection(rows, selectedKey, direction) {
  const nonEmpty = (rows || []).filter((row) => row?.length);
  if (nonEmpty.length === 0) {
    return null;
  }

  let pos = findHomeTilePos(nonEmpty, selectedKey);
  if (!pos) {
    return tileNavKey(nonEmpty[0][0]);
  }

  let { row, col } = pos;

  if (direction === "left") {
    if (col > 0) {
      return tileNavKey(nonEmpty[row][col - 1]);
    }
    if (row > 0) {
      const above = nonEmpty[row - 1];
      return tileNavKey(above[above.length - 1]);
    }
    return selectedKey;
  }

  if (direction === "right") {
    if (col < nonEmpty[row].length - 1) {
      return tileNavKey(nonEmpty[row][col + 1]);
    }
    if (row < nonEmpty.length - 1) {
      return tileNavKey(nonEmpty[row + 1][0]);
    }
    return selectedKey;
  }

  if (direction === "up") {
    if (row <= 0) {
      return selectedKey;
    }
    const above = nonEmpty[row - 1];
    return tileNavKey(above[Math.min(col, above.length - 1)]);
  }

  if (direction === "down") {
    if (row >= nonEmpty.length - 1) {
      return selectedKey;
    }
    const below = nonEmpty[row + 1];
    return tileNavKey(below[Math.min(col, below.length - 1)]);
  }

  return selectedKey;
}
