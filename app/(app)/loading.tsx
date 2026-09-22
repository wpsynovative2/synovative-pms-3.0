import { LoadingScreen } from "@/components/ui/loader";

/**
 * Shown while a signed-in route's code or data is still on its way — chiefly
 * the dynamic project page. Sits inside the app shell, so the sidebar and top
 * bar stay put and only the page area waits.
 */
export default function Loading() {
  return <LoadingScreen className="min-h-[60vh]" />;
}
