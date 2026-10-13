import { createElement } from "react";
import { renderToString } from "react-dom/server";

export function renderHookOnServer<T>(useHook: () => T): T {
  const result: { current?: T } = {};
  function Probe() {
    result.current = useHook();
    return null;
  }
  renderToString(createElement(Probe));
  return result.current as T;
}
