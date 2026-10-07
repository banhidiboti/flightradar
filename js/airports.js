// Just the one airport the UI makes clickable on the map. Kept separate
// from config.js since it's static reference data, not user settings.
export const BUDAPEST_AIRPORT = {
  icao: "LHBP",
  iata: "BUD",
  name: "Liszt Ferenc Nemzetközi Repülőtér",
  lat: 47.4369,
  lon: 19.2556,
};

// A plane counts as a Budapest arrival/departure (orange) rather than
// transit traffic (yellow) if it's within this radius of the airport and
// below this altitude - i.e. actually climbing out after takeoff or
// descending for approach, not just cruising overhead. Both are generous
// (real descent/climb profiles can start this far out) since this is a
// cheap live heuristic, not a real route lookup for every plane on
// screen (that would mean one adsbdb.com request per visible aircraft,
// every poll cycle - far too many).
export const DOMESTIC_RADIUS_KM = 50;
export const DOMESTIC_ALTITUDE_M = 3500;
