import { redirect } from "next/navigation";

export default async function VocabularyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string }>;
}) {
  const params = await searchParams;
  redirect(
    params.lesson && /^w\d{2}d[1-7]$/.test(params.lesson)
      ? `/?lesson=${encodeURIComponent(params.lesson)}`
      : "/",
  );
}
