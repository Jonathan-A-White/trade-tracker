import { act, renderHook } from "@testing-library/react";
import { useUndo } from "./use-undo";

describe("useUndo", () => {
  it("keeps a value per key and drops one key or all of them", () => {
    const { result } = renderHook(() => useUndo<string>("a"));
    act(() => result.current.keep("x", "one"));
    act(() => result.current.keep("y", "two"));
    expect(result.current.kept).toEqual({ x: "one", y: "two" });

    act(() => result.current.drop("x"));
    expect(result.current.kept).toEqual({ y: "two" });

    act(() => result.current.drop());
    expect(result.current.kept).toEqual({});
  });

  it("offers nothing kept for another scope, and a keep in the new scope starts afresh", () => {
    const { result, rerender } = renderHook(({ scope }) => useUndo<string>(scope), { initialProps: { scope: "a" } });
    act(() => result.current.keep("x", "one"));

    rerender({ scope: "b" });
    expect(result.current.kept).toEqual({});

    act(() => result.current.keep("y", "two"));
    expect(result.current.kept).toEqual({ y: "two" });
    rerender({ scope: "a" });
    expect(result.current.kept).toEqual({});
  });
});
