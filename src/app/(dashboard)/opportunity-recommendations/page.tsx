import OpportunityRecommendationsClient from "@/components/opportunities/OpportunityRecommendationsClient";

export default function OpportunityRecommendationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">
        Opportunity Recommendations
      </h1>
      <OpportunityRecommendationsClient />
    </div>
  );
}
