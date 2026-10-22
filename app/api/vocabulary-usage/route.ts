import paths from "@/data/word-usage-paths.json";
export function GET(request: Request) {
  const word = new URL(request.url).searchParams.get("word") || "";
  if (!/^[가-힣 ]{1,50}$/.test(word))
    return Response.json({ error: "请选择有效韩语词条。" }, { status: 400 });
  const path = (paths as Record<string, string>)[word];
  if (!path)
    return Response.json({ error: "没有找到该词的用法。" }, { status: 404 });
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(path, request.url).href,
      "Cache-Control": "public, max-age=300",
    },
  });
}
