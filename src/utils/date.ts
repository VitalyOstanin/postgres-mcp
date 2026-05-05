import { Settings } from "luxon";

let currentTimezone = "Europe/Moscow";

export function initializeTimezone(timezone: string): void {
  currentTimezone = timezone;
  Settings.defaultZone = timezone;
}

export function getTimezone(): string {
  return currentTimezone;
}
