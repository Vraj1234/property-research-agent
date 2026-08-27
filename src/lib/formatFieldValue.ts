import type { BedBathCount, FieldResult, NearbyDistance, PropertyFieldKey } from "./types";

/** Human-readable label for each field, in the display order the result
 * card renders them (PropertyFieldKey's declaration order in types.ts). */
export const FIELD_LABELS: Record<PropertyFieldKey, string> = {
  bedBathCount: "Bed / Bath",
  squareFootage: "Square Footage",
  yearBuilt: "Year Built",
  ownerName: "Owner",
  mortgagee: "Mortgagee",
  hvacType: "HVAC",
  propertyTaxAmount: "Property Tax",
  nearestFireStationDistance: "Nearest Fire Station",
  nearestFireHydrantDistance: "Nearest Fire Hydrant",
};

/** What a row shows while it's still pending (Ticket 9) — names the actual
 * source being checked per PRD.md §5's field→source matrix, not generic
 * flavor text, so it reads as real work rather than a decorative spinner. */
export const FIELD_PENDING_COPY: Record<PropertyFieldKey, string> = {
  bedBathCount: "Checking RentCast, cross-referencing recent listings…",
  squareFootage: "Checking RentCast, cross-referencing recent listings…",
  yearBuilt: "Checking assessor records…",
  ownerName: "Searching public ownership records…",
  mortgagee: "Researching lender records — this one can take a few minutes…",
  hvacType: "Checking property records…",
  propertyTaxAmount: "Checking assessor tax records…",
  nearestFireStationDistance: "Querying OpenStreetMap…",
  nearestFireHydrantDistance: "Querying OpenStreetMap…",
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatBedBath(value: BedBathCount): string {
  const parts: string[] = [];
  if (value.bedrooms !== null) parts.push(`${value.bedrooms} bed`);
  if (value.bathrooms !== null) parts.push(`${value.bathrooms} bath`);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function formatDistance(value: NearbyDistance): string {
  const distance = `${value.distanceMiles} mi`;
  return value.name ? `${distance} — ${value.name}` : distance;
}

/**
 * Renders a single field's value as display text for the result card. Pure
 * and framework-agnostic on purpose — the card component should never need
 * to know these per-field shape differences itself (PRD.md §6: the LLM
 * doesn't write the card, and neither should ad hoc JSX formatting logic).
 */
export function formatFieldValue(field: FieldResult): string {
  if (field.value === null) return "Not found";

  switch (field.field) {
    case "bedBathCount":
      return formatBedBath(field.value as BedBathCount);
    case "squareFootage":
      return `${NUMBER_FORMAT.format(field.value as number)} sqft`;
    case "yearBuilt":
      return String(field.value);
    case "ownerName":
      return (field.value as string[]).join(", ");
    case "mortgagee":
    case "hvacType":
      return field.value as string;
    case "propertyTaxAmount":
      return `${CURRENCY_FORMAT.format(field.value as number)}/yr`;
    case "nearestFireStationDistance":
    case "nearestFireHydrantDistance":
      return formatDistance(field.value as NearbyDistance);
    default:
      return String(field.value);
  }
}
