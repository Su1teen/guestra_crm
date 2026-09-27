import type { ServiceCatalogEntry } from "@/types/crm";

export const stayNights = (arrival: string, departure: string) => {
  if (!arrival || !departure) return 0;
  const start = Date.parse(`${arrival.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${departure.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 86_400_000) : 0;
};

export const accommodationNightlyRate = (catalog: ServiceCatalogEntry[], propertyId: string, unitType: string) => {
  const entry = catalog.find((item) => item.active && item.propertyId === propertyId &&
    item.serviceType === "accommodation" && item.name === unitType && item.pricingMode === "per_night_per_unit");
  return entry?.defaultPrice != null && entry.defaultPrice >= 0 ? entry.defaultPrice : undefined;
};

export const accommodationTotal = (catalog: ServiceCatalogEntry[], propertyId: string, unitType: string, arrival: string, departure: string) => {
  const rate = accommodationNightlyRate(catalog, propertyId, unitType);
  const nights = stayNights(arrival, departure);
  return rate === undefined || nights < 1 ? undefined : rate * nights;
};
