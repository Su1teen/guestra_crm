import { useMemo } from "react";
import { useCrm } from "@/store/crm-store";
import type {
  Campaign,
  Conversation,
  FollowUp,
  Guest,
  GuestStay,
  HousekeepingTask,
  Lead,
  MaintenanceTicket,
  Offer,
  OperationalTask,
  PmsDailySnapshot,
  Room,
  SalesMetricPoint,
  Task,
} from "@/types/crm";

export interface ScopedData {
  leads: Lead[];
  offers: Offer[];
  tasks: Task[];
  conversations: Conversation[];
  guests: Guest[];
  stays: GuestStay[];
  campaigns: Campaign[];
  metrics: SalesMetricPoint[];
  followUps: FollowUp[];
  rooms: Room[];
  housekeepingTasks: HousekeepingTask[];
  maintenanceTickets: MaintenanceTicket[];
  operationalTasks: OperationalTask[];
  pmsSnapshots: PmsDailySnapshot[];
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
        followUps: data.followUps,
        rooms: data.rooms,
        housekeepingTasks: data.housekeepingTasks,
        maintenanceTickets: data.maintenanceTickets,
        operationalTasks: data.operationalTasks,
        pmsSnapshots: data.pmsSnapshots,
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
      followUps: data.followUps.filter((item) => item.propertyId === property),
      rooms: data.rooms.filter((room) => room.propertyId === property),
      housekeepingTasks: data.housekeepingTasks.filter((task) => task.propertyId === property),
      maintenanceTickets: data.maintenanceTickets.filter((ticket) => ticket.propertyId === property),
      operationalTasks: data.operationalTasks.filter((task) => task.propertyId === property),
      pmsSnapshots: data.pmsSnapshots.filter((snapshot) => snapshot.propertyId === property),
    };
  }, [data, property]);
};
