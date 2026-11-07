import { requireArea } from "@/lib/auth";

export default async function CaptainLayout({ children }: LayoutProps<"/captain">) {
  await requireArea("captain");
  return <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>;
}
