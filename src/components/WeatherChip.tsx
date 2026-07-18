import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CloudSun, Cloud, CloudRain, CloudSnow, CloudLightning, Sun } from "lucide-react";
import { getWeather } from "@/lib/weather.functions";

function IconFor({ code }: { code: number }) {
  const cls = "h-4 w-4";
  if (code === 0) return <Sun className={cls} />;
  if (code >= 95) return <CloudLightning className={cls} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={cls} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={cls} />;
  if (code === 1 || code === 2) return <CloudSun className={cls} />;
  return <Cloud className={cls} />;
}

export function WeatherChip({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  const fetchWeather = useServerFn(getWeather);
  const { data, isLoading } = useQuery({
    queryKey: ["weather", lat.toFixed(2), lng.toFixed(2)],
    queryFn: () => fetchWeather({ data: { lat, lng } }),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  if (isLoading || !data || (data as any).error) return null;
  const w = data as { tempC: number; code: number; summary: string; highC: number; lowC: number };
  return (
    <span className="chip inline-flex items-center gap-1.5">
      <IconFor code={w.code} />
      <span className="font-semibold">{w.tempC}°C</span>
      <span className="text-muted-foreground">
        {w.summary}
        {label ? ` · ${label}` : ""} · {w.lowC}/{w.highC}°
      </span>
    </span>
  );
}
