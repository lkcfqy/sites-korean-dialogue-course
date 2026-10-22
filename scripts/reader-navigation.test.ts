import assert from "node:assert/strict";
import test from "node:test";
import {
  createElement,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import Home from "../app/page";
import { ReaderDialogues } from "../components/reader-dialogues";
import { ReaderNavigation } from "../components/reader-navigation";
import catalog from "../public/reader/index.json";
import type { ReaderLessonSummary } from "../lib/reader-types";

type ElementProps = {
  children?: ReactNode;
  className?: string;
  href?: string;
  rel?: string;
  "aria-label"?: string;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

for (const index of [0, 1, catalog.lessons.length - 1]) {
  test(`reader page preserves accessible links and lesson boundaries at index ${index}`, async () => {
    const lesson = catalog.lessons[index];
    const tree = await Home({
      searchParams: Promise.resolve({ lesson: lesson.id }),
    });
    const nodes = elements(tree);
    const brand = nodes.find((node) => node.props.className === "reader-brand");
    assert(brand);
    assert.equal(brand.type, Link);
    assert.equal(brand.props.href, "/");
    assert.equal(brand.props["aria-label"], "韩语对话课首页");
    const skip = nodes.find((node) => node.props.className === "reader-skip");
    assert(skip);
    assert.equal(skip.type, "a");
    assert.equal(skip.props.href, "#dialogues");

    for (const [rel, offset] of [
      ["prev", -1],
      ["next", 1],
    ] as const) {
      const link = nodes.find((node) => node.props.rel === rel);
      const adjacent = catalog.lessons[index + offset];
      if (adjacent) {
        assert(link);
        assert.equal(link.type, Link);
        assert.equal(link.props.href, `/?lesson=${adjacent.id}`);
      } else {
        assert.equal(link, undefined);
      }
    }
    // A new lesson must reset its audio and word-popup component state.
    assert.equal(
      nodes.find((node) => node.type === ReaderDialogues)?.key,
      lesson.id,
    );
  });
}

test("week and lesson selectors use router history and encode lesson IDs", () => {
  const lessons: ReaderLessonSummary[] = [
    { id: "w1d1", week: 1, day: 1, title: "一", scene: "", sectionCount: 1 },
    { id: "w1d2", week: 1, day: 2, title: "二", scene: "", sectionCount: 1 },
    {
      id: "补充 &?#",
      week: 27,
      day: 1,
      title: "补充",
      scene: "",
      sectionCount: 1,
    },
  ];
  const pushed: string[] = [];
  const unexpectedNavigation = () => assert.fail("must push a history entry");
  const router: AppRouterInstance = {
    push: (href) => pushed.push(href),
    replace: unexpectedNavigation,
    back: unexpectedNavigation,
    forward: unexpectedNavigation,
    refresh: unexpectedNavigation,
    prefetch: unexpectedNavigation,
    bfcacheId: "test",
  };
  let captured: ReactNode;
  function CaptureNavigation() {
    // Render inside the real router provider, then exercise the actual handlers.
    captured = ReaderNavigation({ lessons, currentId: "w1d1" });
    return captured;
  }
  const html = renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(CaptureNavigation),
    ),
  );
  assert.match(html, /aria-label="课程目录"/);
  assert.match(html, /选择周次/);
  assert.match(html, /选择课程/);
  assert.match(html, /补充对话/);
  const selects = elements(captured).filter(
    (node) => node.type === "select",
  ) as ReactElement<SelectHTMLAttributes<HTMLSelectElement>>[];
  assert.equal(selects.length, 2);
  assert.equal(selects[0].props.value, 1);
  assert.equal(selects[1].props.value, "w1d1");
  const change = (index: number, value: string) =>
    selects[index].props.onChange?.({
      target: { value },
    } as ChangeEvent<HTMLSelectElement>);
  change(1, "w1d2");
  change(0, "27");
  change(0, "999");
  change(1, "补充 &?#");
  assert.deepEqual(pushed, [
    "/?lesson=w1d2",
    `/?lesson=${encodeURIComponent("补充 &?#")}`,
    `/?lesson=${encodeURIComponent("补充 &?#")}`,
  ]);
});
