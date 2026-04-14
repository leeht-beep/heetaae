import { ResellWorkbench } from "@/components/ResellWorkbench";
import { DEFAULT_COST_SETTINGS, DEFAULT_SEARCH_TERM } from "@/lib/constants";
import { searchResellOpportunities } from "@/lib/services/search-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialData = await searchResellOpportunities(
    DEFAULT_SEARCH_TERM,
    DEFAULT_COST_SETTINGS,
  );

  return <ResellWorkbench initialData={initialData} />;
}
