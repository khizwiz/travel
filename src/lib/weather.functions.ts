import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Storm w/ hail", 99: "Storm w/ hail",
};

export const getWeather = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${data.lat}&longitude=${data.lng}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=1`;
      const r = await fetch(url);
      if (!r.ok) return { error: "Weather unavailable" as const };
      const j: any = await r.json();
      const code = j.current?.weather_code ?? 0;
      return {
        tempC: Math.round(j.current?.temperature_2m ?? 0),
        windKph: Math.round((j.current?.wind_speed_10m ?? 0)),
        code,
        summary: WMO[code] ?? "—",
        highC: Math.round(j.daily?.temperature_2m_max?.[0] ?? 0),
        lowC: Math.round(j.daily?.temperature_2m_min?.[0] ?? 0),
      };
    } catch {
      return { error: "Weather unavailable" as const };
    }
  });
