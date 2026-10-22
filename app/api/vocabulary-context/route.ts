import contexts from "@/data/immersion-context.json";
import postContexts from "@/data/immersion-post-course-context.json";
import { mergeDialogueContexts } from "@/lib/dialogue-catalog";
export function GET(request: Request) {
  const word = new URL(request.url).searchParams.get("word") ?? "";
  if (!/^[가-힣 ]{1,50}$/.test(word)) return Response.json([], { status: 400 });
  const main = (contexts as Record<string, { ko: string }[]>)[word] ?? [];
  const post = (postContexts as Record<string, { ko: string }[]>)[word] ?? [];
  return Response.json(mergeDialogueContexts(main, post), {
    headers: { "Cache-Control": "public,max-age=3600" },
  });
}
