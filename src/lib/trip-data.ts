// Seed itinerary, vehicle, and traveller data for Tripping.
// Sensitive details (exact addresses, booking URLs) are flagged private.

export type TransportMode = "drive" | "flight" | "ferry" | "mixed";
export type DayStatus = "upcoming" | "active" | "completed" | "paused" | "missed";

export type DayKind = "destination" | "rest" | "open" | "empty";

export interface ItineraryDay {
  id: string;
  date: string; // ISO YYYY-MM-DD
  from: string;
  to: string;
  transport: TransportMode;
  travellers: string[]; // names
  kind?: DayKind;
  distanceKm?: number | null;
  durationMin?: number | null; // driving / flight / ferry duration
  borderWaitMin?: number;
  accommodation?: {
    name: string;
    addressPublic?: string;
    addressPrivate?: string;
    privateNote?: string;
  } | null;
  flight?: {
    airline: string;
    number: string;
    from: string;
    to: string;
    departLocal: string;
    arriveLocal: string;
    durationMin: number;
    reservation?: string;
    bookingRef?: string;
    seats?: Record<string, string>;
    baggageNote?: string;
  };
  ferry?: {
    operator?: string;
    from: string;
    to: string;
    departLocal?: string;
    arriveLocal?: string;
    durationMin?: number;
    bookingRef?: string;
    note?: string;
  };
  notes?: string;
  missing?: string[]; // information required tags
}

export const TRAVELLERS = {
  khizar: { name: "Khizar", role: "owner" as const, email: "owner@example.com" },
  simona: { name: "Simona", role: "traveller" as const, email: "member1@example.com" },
  fez: { name: "Fez", role: "child" as const, note: "Managed by parent account" },
};

export const VEHICLE = {
  make: "Mitsubishi",
  model: "L200",
  year: 2018,
  engine: "2.4 DI-D",
  transmission: "Automatic",
  fuel: "Diesel",
  registration: "34CCZ015",
  tankLitres: 75,
  tyresFrontPsi: 30,
  tyresRearPsi: 30,
  lowFuelWarnPct: 25,
  lastServiceDate: null as string | null, // information required
  lastServiceOdometer: null as number | null, // information required
};

// The app soft-launches for the public on 17 July 2026 at 05:00 Europe/Istanbul.
// Owner + crew bypass this gate. Everyone else sees a countdown splash.
export const APP_KICKOFF_ISO = "2026-07-17T05:00:00+03:00";
export const APP_KICKOFF_MS = new Date(APP_KICKOFF_ISO).getTime();

export function isAppLive(nowMs: number = Date.now()): boolean {
  return nowMs >= APP_KICKOFF_MS;
}

const D = (dateISO: string, partial: Omit<ItineraryDay, "id" | "date">): ItineraryDay => ({
  id: dateISO,
  date: dateISO,
  ...partial,
});


export const ITINERARY: ItineraryDay[] = [
  D("2026-07-18", {
    from: "Istanbul",
    to: "Sofia",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 565,
    durationMin: 7 * 60 + 30,
    borderWaitMin: 60,
    accommodation: null,
    missing: ["Sofia accommodation"],
    notes: "Departure leg. Border at KapÄ±kule.",
  }),
  D("2026-07-19", {
    from: "Sofia",
    to: "Belgrade",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 395,
    durationMin: 5 * 60 + 0,
    borderWaitMin: 45,
    accommodation: null,
    missing: ["Belgrade accommodation"],
  }),
  D("2026-07-20", {
    from: "Belgrade",
    to: "Budapest",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 385,
    durationMin: 4 * 60 + 30,
    borderWaitMin: 60,
    accommodation: null,
    missing: ["Budapest accommodation"],
  }),
  D("2026-07-21", {
    from: "Budapest",
    to: "Budapest",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 0,
    durationMin: 0,
    accommodation: null,
    notes: "Rest day in Budapest.",
    missing: ["Budapest accommodation"],
  }),
  D("2026-07-22", {
    from: "Budapest",
    to: "Budapest",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 0,
    durationMin: 0,
    accommodation: null,
    notes: "Second day in Budapest.",
    missing: ["Budapest accommodation"],
  }),
  D("2026-07-23", {
    from: "Budapest",
    to: "Zagreb",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 345,
    durationMin: 4 * 60,
    accommodation: null,
    missing: ["Zagreb accommodation"],
  }),
  D("2026-07-24", {
    from: "Zagreb",
    to: "Riccione",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 605,
    durationMin: 6 * 60 + 30,
    accommodation: null,
    missing: ["Riccione accommodation"],
  }),
  D("2026-07-25", {
    from: "Riccione",
    to: "Rome",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: 330,
    durationMin: 3 * 60 + 30,
    accommodation: null,
    missing: ["Rome accommodation"],
  }),
  D("2026-07-26", {
    from: "Rome",
    to: "Berlin",
    transport: "flight",
    travellers: ["Khizar", "Fez"],
    distanceKm: null,
    durationMin: 2 * 60 + 10,
    flight: {
      airline: "Ryanair",
      number: "FR41",
      from: "FCO",
      to: "BER",
      departLocal: "10:25",
      arriveLocal: "12:35",
      durationMin: 2 * 60 + 10,
      reservation: "Q6KLRN",
      seats: { Khizar: "21C", Fez: "21B" },
      baggageNote: "Khizar: Priority + 2 cabin bags. Fez: standard.",
    },
    accommodation: {
      name: "Old Town Apartments",
      addressPublic: "Berlin, Germany",
      addressPrivate: "SchĂ¶nhauser Allee 5, 10119 Berlin, Germany",
      privateNote: "Exact address, booking URL and reference are private.",
    },
  }),
  ...[27, 28, 29].map((d) =>
    D(`2026-07-${d}`, {
      from: "Berlin",
      to: "Berlin",
      transport: "drive",
      travellers: ["Khizar", "Fez"],
      distanceKm: 0,
      durationMin: 0,
      accommodation: {
        name: "Old Town Apartments",
        addressPublic: "Berlin, Germany",
        addressPrivate: "SchĂ¶nhauser Allee 5, 10119 Berlin, Germany",
      },
      notes: "Berlin stay.",
    }),
  ),
  D("2026-07-30", {
    from: "Berlin",
    to: "Rome",
    transport: "flight",
    travellers: ["Khizar", "Fez"],
    distanceKm: null,
    durationMin: 2 * 60 + 10,
    flight: {
      airline: "easyJet",
      number: "U25079",
      from: "BER T1",
      to: "FCO T1",
      departLocal: "17:35",
      arriveLocal: "19:45",
      durationMin: 2 * 60 + 10,
      bookingRef: "KCT7S9Z",
      reservation: "Trip.com 1638322148318504",
      baggageNote:
        "Personal item up to 45Ă—36Ă—20 cm per traveller. Khizar: additional purchased 15 kg cabin bag.",
    },
    accommodation: null,
    missing: ["Rome accommodation (return night)"],
  }),
  D("2026-07-31", {
    from: "Rome",
    to: "Lake Garda",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 530,
    durationMin: 5 * 60 + 30,
    accommodation: null,
    missing: ["Lake Garda accommodation"],
  }),
  ...Array.from({ length: 18 }, (_, i) => {
    const day = 1 + i;
    return D(`2026-08-${String(day).padStart(2, "0")}`, {
      from: "Open planning period",
      to: "Open planning period",
      transport: "drive",
      travellers: ["Khizar"],
      kind: "open",
      distanceKm: null,
      durationMin: null,
      accommodation: null,
      notes: "Owner to decide destination, activity or rest day.",
    });
  }),


  D("2026-08-18", {
    from: "Milan / open",
    to: "Verona",
    transport: "drive",
    travellers: ["Khizar"],
    distanceKm: null,
    durationMin: null,
    accommodation: null,
    notes: "Arrive Verona; reunite with Simona & Fez for the drive home.",
  }),
  D("2026-08-19", {
    from: "Verona",
    to: "Verona",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 0,
    durationMin: 0,
    accommodation: null,
    kind: "rest",
    notes: "Rest day in Verona before the ferry.",
  }),
  D("2026-08-20", {
    from: "Verona",
    to: "Ancona (ferry)",
    transport: "mixed",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 300,
    durationMin: 3 * 60 + 15,
    ferry: {
      from: "Ancona",
      to: "Patras",
      departLocal: "18:00",
      durationMin: 21 * 60,
      note: "Overnight ferry â€” cabin sleep onboard.",
    },
    accommodation: null,
    missing: ["Anconaâ€“Patras ferry booking reference"],
  }),
  D("2026-08-21", {
    from: "Patras (arrive 15:00)",
    to: "Athens",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 215,
    durationMin: 2 * 60 + 30,
    accommodation: null,
    notes: "Ferry arrives Patras 15:00; drive on to Athens for the night.",
    missing: ["Athens accommodation"],
  }),
  D("2026-08-22", {
    from: "Athens",
    to: "Athens",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 0,
    durationMin: 0,
    kind: "rest",
    notes: "Athens rest day. 0 driving hours.",
    accommodation: null,
  }),
  D("2026-08-23", {
    from: "Athens",
    to: "Pelion / Volos area",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 330,
    durationMin: 3 * 60 + 45,
    accommodation: null,
    missing: ["Pelion / Volos accommodation"],
  }),
  D("2026-08-24", {
    from: "Pelion / Volos area",
    to: "Halkidiki / near Thessaloniki",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 280,
    durationMin: 3 * 60,
    accommodation: null,
    missing: ["Halkidiki accommodation"],
  }),
  D("2026-08-25", {
    from: "Halkidiki / Thessaloniki",
    to: "Alexandroupoli",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 340,
    durationMin: 3 * 60 + 45,
    accommodation: null,
    missing: ["Alexandroupoli accommodation"],
  }),
  D("2026-08-26", {
    from: "Alexandroupoli",
    to: "Edirne",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 120,
    durationMin: 2 * 60,
    borderWaitMin: 60,
    accommodation: null,
    notes: "Cross via Kipi/Ä°psala border into Turkey. Overnight in Edirne.",
    missing: ["Edirne accommodation"],
  }),
  D("2026-08-27", {
    from: "Edirne",
    to: "Istanbul",
    transport: "drive",
    travellers: ["Khizar", "Simona", "Fez"],
    distanceKm: 240,
    durationMin: 2 * 60 + 45,
    accommodation: null,
    notes: "Home run â€” Edirne to Istanbul.",
  }),
];


export const MISSING_INFO: { item: string; why: string; where: string; blocking: boolean }[] = [
  {
    item: "Remaining hotels (Sofia, Belgrade, Budapest, Zagreb, Riccione, Rome, Lake Garda, Pescara/Chieti, Athens, Alexandroupoli, Edirne)",
    why: "Check-in reminders and Today screen accommodation card cannot populate without confirmed bookings.",
    where: "Itinerary cards Â· Today Â· Bookings Â· Reminders",
    blocking: false,
  },
  {
    item: "Bariâ€“Patras ferry booking",
    why: "Operator-specific check-in time, vehicle deck loading window, and cabin number drive the 21 Aug reminders.",
    where: "21 Aug itinerary card Â· Bookings Â· Reminders",
    blocking: false,
  },
  {
    item: "AFF Skydiving provider & dropzone (Milan area)",
    why: "Determines exact location, schedule, medical paperwork, and weather monitoring rules.",
    where: "3â€“4 Aug itinerary cards Â· Reminders Â· Weather warnings",
    blocking: false,
  },
  {
    item: "AFF course schedule",
    why: "Morning briefing times and per-jump windows drive day-of reminders.",
    where: "3â€“4 Aug itinerary Â· Reminders",
    blocking: false,
  },
  {
    item: "AFF nearby accommodation",
    why: "Distance from dropzone affects wake-up times and transport.",
    where: "3â€“4 Aug itinerary Â· Bookings",
    blocking: false,
  },
  {
    item: "Last vehicle service date & odometer at service",
    why: "Drives the service-distance reminder threshold.",
    where: "Vehicle & Journey dashboard",
    blocking: false,
  },
  {
    item: "Volos vs Larissa final selection",
    why: "Day 25 Aug distance and duration recalculate after the choice.",
    where: "24â€“25 Aug itinerary cards",
    blocking: false,
  },
  {
    item: "Passenger details (when added)",
    why: "Friendly slug, travel dates, and permissions are required before invitations can be sent.",
    where: "Access & Passengers",
    blocking: false,
  },
];

export function getActiveDayId(today = new Date()): string {
  const isoToday = today.toISOString().slice(0, 10);
  const exact = ITINERARY.find((d) => d.date === isoToday);
  if (exact) return exact.id;
  if (isoToday < ITINERARY[0].date) return ITINERARY[0].id;
  if (isoToday > ITINERARY[ITINERARY.length - 1].date) return ITINERARY[ITINERARY.length - 1].id;
  const past = [...ITINERARY].reverse().find((d) => d.date <= isoToday);
  return past ? past.id : ITINERARY[0].id;
}

export type TripPhase = "before" | "active" | "after";
export interface TripProgress {
  phase: TripPhase;
  /** Index of the latest day with date <= today; -1 before trip. */
  index: number;
  todayISO: string;
  daysUntilStart: number;
  todayDay: ItineraryDay | null;
}
export function getTripProgress(
  today = new Date(),
  liveFix?: { lat: number; lng: number } | null,
): TripProgress {
  const isoToday = today.toISOString().slice(0, 10);
  const first = ITINERARY[0].date;
  const last = ITINERARY[ITINERARY.length - 1].date;
  if (isoToday < first) {
    const ms =
      new Date(first + "T00:00:00").getTime() - new Date(isoToday + "T00:00:00").getTime();
    return {
      phase: "before",
      index: -1,
      todayISO: isoToday,
      daysUntilStart: Math.max(0, Math.round(ms / 86400000)),
      todayDay: null,
    };
  }
  if (isoToday > last) {
    return {
      phase: "after",
      index: ITINERARY.length - 1,
      todayISO: isoToday,
      daysUntilStart: 0,
      todayDay: null,
    };
  }
  let idx = 0;
  for (let i = 0; i < ITINERARY.length; i++) if (ITINERARY[i].date <= isoToday) idx = i;

  // If a live GPS fix is provided, override the index with the itinerary day
  // whose destination is nearest (within 150km). Falls back to the calendar
  // date when no city is within range.
  if (liveFix) {
    // Local import-free port to avoid circular imports.
    let best: { i: number; km: number } | null = null;
    for (let i = 0; i < ITINERARY.length; i++) {
      const label = ITINERARY[i].to || ITINERARY[i].from;
      const coord = CITY_COORDS_INLINE[label] ?? findLooseCoord(label);
      if (!coord) continue;
      const km = haversineKmInline(liveFix, coord);
      if (!best || km < best.km) best = { i, km };
    }
    if (best && best.km <= 150) idx = best.i;
  }

  return {
    phase: "active",
    index: idx,
    todayISO: isoToday,
    daysUntilStart: 0,
    todayDay: liveFix ? ITINERARY[idx] : ITINERARY[idx].date === isoToday ? ITINERARY[idx] : null,
  };
}

// Inlined to avoid a src/lib/geo.ts <-> trip-data.ts cycle.
const CITY_COORDS_INLINE: Record<string, { lat: number; lng: number }> = {
  Istanbul: { lat: 41.0082, lng: 28.9784 },
  Edirne: { lat: 41.6771, lng: 26.5557 },
  Sofia: { lat: 42.6977, lng: 23.3219 },
  Belgrade: { lat: 44.7866, lng: 20.4489 },
  Budapest: { lat: 47.4979, lng: 19.0402 },
  Zagreb: { lat: 45.815, lng: 15.9819 },
  "Lake Garda": { lat: 45.6, lng: 10.65 },
  Verona: { lat: 45.4384, lng: 10.9916 },
  Milan: { lat: 45.4642, lng: 9.19 },
  Riccione: { lat: 43.9989, lng: 12.6557 },
  Rome: { lat: 41.9028, lng: 12.4964 },
  Pescara: { lat: 42.4584, lng: 14.2081 },
  Bari: { lat: 41.1171, lng: 16.8719 },
  Igoumenitsa: { lat: 39.5036, lng: 20.265 },
  Athens: { lat: 37.9838, lng: 23.7275 },
  Alexandroupoli: { lat: 40.8458, lng: 25.8736 },
  Thessaloniki: { lat: 40.6401, lng: 22.9444 },
  Berlin: { lat: 52.52, lng: 13.405 },
  Patras: { lat: 38.2466, lng: 21.7346 },
};
function findLooseCoord(label: string) {
  if (!label) return null;
  for (const key of Object.keys(CITY_COORDS_INLINE)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return CITY_COORDS_INLINE[key];
  }
  return null;
}
function haversineKmInline(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDuration(min?: number | null): string {
  if (min == null) return "â€”";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateLong(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
