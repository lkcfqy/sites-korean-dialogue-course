import type { Skill } from "@/lib/study-records";
export type Exercise = { id: string; week: number; skill: Skill; prompt: string; audio?: string; passage?: string; options?: string[]; accepted: string[]; explanation: string; sourceTitle: string; lessonId?: string; target?: string };
