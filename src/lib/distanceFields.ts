import { haversineDistanceMiles } from "./haversine";
import { queryNearbyNodes, OverpassError, type OverpassNode } from "./overpass";
import type { FieldResult, NearbyDistance, PropertyFieldKey } from "./types";

/** Live-tested 2026-08-26: 0 fire stations within 8km of a real suburban
 * address, 6 within 20km — fire stations are genuinely sparser in OSM than
 * hydrants, so this radius is set wider (see decisions.md). */
const FIRE_STATION_RADIUS_METERS = 25_000;

/** Hydrants are dense in developed areas; a real gap beyond this radius is
 * the documented rural/under-mapped OSM coverage limitation (PRD.md §5),
 * not something a bigger radius would meaningfully fix. */
const FIRE_HYDRANT_RADIUS_METERS = 3_000;

function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

function closest(nodes: OverpassNode[], latitude: number, longitude: number): NearbyDistance {
  let nearest = nodes[0];
  let nearestDistance = haversineDistanceMiles(latitude, longitude, nearest.lat, nearest.lon);

  for (const node of nodes.slice(1)) {
    const distance = haversineDistanceMiles(latitude, longitude, node.lat, node.lon);
    if (distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }

  return { distanceMiles: Math.round(nearestDistance * 100) / 100, name: nearest.name };
}

interface DistanceFieldSpec {
  field: PropertyFieldKey;
  tagKey: string;
  tagValue: string;
  radiusMeters: number;
  label: string;
}

/**
 * Builds one distance FieldResult from a live Overpass query + haversine.
 * No fallback exists for these two fields (PRD.md §5 shows "—" in the
 * fallback column) — either OSM has a match nearby, or it honestly doesn't,
 * same treatment either way: a null value with an explanatory note, never a
 * thrown error that could take down the rest of `/api/research`.
 */
async function resolveDistanceField(
  spec: DistanceFieldSpec,
  latitude: number,
  longitude: number,
): Promise<FieldResult<NearbyDistance>> {
  try {
    const nodes = await queryNearbyNodes(latitude, longitude, spec.tagKey, spec.tagValue, spec.radiusMeters);
    if (nodes.length === 0) {
      return {
        field: spec.field,
        value: null,
        source: null,
        confidence: null,
        note:
          `No ${spec.label} found within ${metersToMiles(spec.radiusMeters).toFixed(1)} miles ` +
          "via OpenStreetMap — a known coverage gap in some areas, not a lookup failure.",
      };
    }

    return {
      field: spec.field,
      value: closest(nodes, latitude, longitude),
      source: "OpenStreetMap Overpass",
      confidence: "high",
    };
  } catch (err) {
    console.error(`[distanceFields] Overpass lookup failed for ${spec.label}:`, err);
    const message = err instanceof OverpassError ? err.message : "Unexpected Overpass failure.";
    return {
      field: spec.field,
      value: null,
      source: null,
      confidence: null,
      note: `OpenStreetMap Overpass lookup failed: ${message}`,
    };
  }
}

/**
 * The two PRD.md §5 fields with no Parallel.ai fallback — always computable
 * from a live public API + geometry, or honestly not found. Independent of
 * RentCast/Parallel; only needs the geocoded point, so the orchestrator can
 * run this in parallel with the RentCast pipeline (PRD.md §8).
 */
export async function distanceFields(latitude: number, longitude: number): Promise<FieldResult[]> {
  return Promise.all([
    resolveDistanceField(
      {
        field: "nearestFireStationDistance",
        tagKey: "amenity",
        tagValue: "fire_station",
        radiusMeters: FIRE_STATION_RADIUS_METERS,
        label: "fire station",
      },
      latitude,
      longitude,
    ),
    resolveDistanceField(
      {
        field: "nearestFireHydrantDistance",
        tagKey: "emergency",
        tagValue: "fire_hydrant",
        radiusMeters: FIRE_HYDRANT_RADIUS_METERS,
        label: "fire hydrant",
      },
      latitude,
      longitude,
    ),
  ]);
}
