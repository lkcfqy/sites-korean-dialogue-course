"use client";

import { useId, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  exportBrowserStudy,
  importBrowserStudy,
  parseBackup,
  MAX_BACKUP_BYTES,
} from "@/lib/study-backup";
import { STUDY_EVENT } from "@/lib/study-records";

export function StudySettings() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const titleId = useId();

  async function download() {
    setExporting(true);
    try {
      const raw = JSON.stringify(await exportBrowserStudy(localStorage));
      const url = URL.createObjectURL(
        new Blob([raw], { type: "application/json" }),
      );
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `korean-study-${date}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "备份已导出，包含句子与词汇反馈、表达草稿、参考揭晓记录、学习计划、续学位置和设置。",
      );
    } catch {
      setMessage("备份失败，请检查浏览器存储。");
    } finally {
      setExporting(false);
    }
  }

  async function restore(chosen: File) {
    setRestoring(true);
    try {
      if (chosen.size > MAX_BACKUP_BYTES) throw new Error("文件超过 32 MB。");
      const backup = parseBackup(await chosen.text());
      const result = await importBrowserStudy(localStorage, backup);
      setMessage(
        `已合并 ${result.restored} 项，保留本机 ${result.preserved} 项设置、位置或草稿。表达练习可载入合并记录；续学位置与设置在刷新后恢复。`,
      );
      window.dispatchEvent(
        new CustomEvent(STUDY_EVENT, { detail: { source: "import" } }),
      );
    } catch (error) {
      setMessage(
        `未导入：${error instanceof Error ? error.message : "文件无法读取"}`,
      );
    } finally {
      setRestoring(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="study-settings">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="settings-toggle"
            aria-label="打开学习设置"
          >
            <Settings2 size={20} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="settings-panel"
          align="end"
          sideOffset={12}
          aria-labelledby={titleId}
          style={{
            position: "relative",
            top: "auto",
            right: "auto",
            maxHeight: "calc(100dvh - 80px)",
            overflowY: "auto",
          }}
        >
          <strong id={titleId}>学习设置</strong>
          <p>
            句子反馈、表达草稿、计划和续学位置保存在此浏览器。换设备前请备份；导入保留本机已有草稿和设置。
          </p>
          <div>
            <button
              type="button"
              disabled={restoring || exporting}
              onClick={download}
            >
              {exporting ? "正在导出…" : "导出备份"}
            </button>
            <button
              type="button"
              disabled={restoring || exporting}
              onClick={() => file.current?.click()}
            >
              {restoring ? "正在导入…" : "导入备份"}
            </button>
          </div>
          <p role="status" aria-live="polite">
            {message}
          </p>
          <p>
            用 26
            周对话循序渐进培养高级韩语能力。每天投入可调整；阶段回顾通过新情境的理解、回应与表达检查进步。
          </p>
          <button
            type="button"
            className="settings-close"
            onClick={() => setOpen(false)}
          >
            关闭
          </button>
        </PopoverContent>
      </Popover>
      <input
        className="sr-only"
        ref={file}
        type="file"
        accept=".json,application/json"
        aria-label="选择学习备份"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files?.[0]) void restore(event.target.files[0]);
        }}
      />
    </div>
  );
}
