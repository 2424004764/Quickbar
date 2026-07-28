/**
 * 搜索查询：防抖调用宿主 search，并维护选中项
 * 用序号丢弃过期响应，避免失焦再唤起时旧结果盖住当前查询
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { search as searchApi } from "../pluginApi/api";

/**
 * @returns {{
 *   query: string,
 *   setQuery: (q: string) => void,
 *   results: import("../pluginApi/api").SearchItem[],
 *   selectedIndex: number,
 *   setSelectedIndex: (i: number) => void,
 *   loading: boolean,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const queryRef = useRef(query);
  const seqRef = useRef(0);

  queryRef.current = query;

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    const q = queryRef.current;
    setLoading(true);
    try {
      const items = await searchApi(q);
      // 已有更新的搜索在飞，丢弃本次结果
      if (seq !== seqRef.current) {
        return;
      }
      setResults(Array.isArray(items) ? items : []);
      setSelectedIndex(0);
    } catch (err) {
      if (seq !== seqRef.current) {
        return;
      }
      console.error("search failed", err);
      setResults([]);
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 80);
    return () => clearTimeout(timer);
  }, [query, refresh]);

  return {
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    loading,
    refresh,
  };
}
