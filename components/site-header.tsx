"use client";

import { MessagesSquare } from "lucide-react";
import { StudySettings } from "@/components/study-settings";

export function SiteHeader({
  active,
  week,
  lessonId,
}: {
  active: "course" | "vocabulary";
  week?: number;
  lessonId?: string;
}) {
  const query = lessonId ? `?lesson=${lessonId}` : "";
  return (
    <header className="site-header">
      <div className="brand-mark" aria-hidden="true">
        말
      </div>
      <div className="brand-copy">
        <strong>韩语对话课</strong>
        <span>26 周 · 对话沉浸学习</span>
      </div>
      <nav className="site-navigation" aria-label="学习内容">
        <a
          href={`/${query}`}
          aria-current={active === "course" ? "page" : undefined}
        >
          <MessagesSquare size={20} />
          <span>听与说</span>
        </a>
      </nav>
      {week && (
        <div className="header-progress">
          <span>26 周 · 182 天</span>
          <strong>{week > 26 ? "结课后间隔复现" : `第 ${week} 周`}</strong>
        </div>
      )}
      <StudySettings />
    </header>
  );
}
