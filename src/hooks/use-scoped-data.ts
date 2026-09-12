import { useMemo } from "react";
import { useCrm } from "@/store/crm-store";
import type { Campaign, Conversation, Guest, GuestStay, Lead, Offer, SalesMetricPoint, Task } from "@/types/crm";

export interface ScopedData {
  leads: Lead[];
  offers: Offer[];
  tasks: Task[];
  conversations: Conversation[];
  guests: Guest[];
  stays: GuestStay[];
  campaigns: Campaign[];
  metrics: SalesMetricPoint[];
}

export const useScopedData = (): ScopedData => {
  const { data, property } = useCrm();

  return useMemo(() => {
    if (property === "all") {
      return {
        leads: data.leads,
        offers: data.offers,
        tasks: data.tasks,
        conversations: data.conversations,
        guests: data.guests,
        stays: data.stays,
        campaigns: data.campaigns,
        metrics: data.metrics,
      };
    }

    return {
      leads: data.leads.filter((lead) => lead.propertyId === property),
      offers: data.offers.filter((offer) => offer.propertyId === property),
      tasks: data.tasks.filter((task) => task.propertyId === property),
      conversations: data.conversations.filter((conversation) => conversation.propertyId === property),
      guests: data.guests.filter((guest) => guest.propertyIds.includes(property)),
      stays: data.stays.filter((stay) => stay.propertyId === property),
      campaigns: data.campaigns.filter((campaign) => campaign.propertyId === property || campaign.propertyId === "all"),
      metrics: data.metrics.filter((point) => point.propertyId === property),
    };
  }, [data, property]);
};
