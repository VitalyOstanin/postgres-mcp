import { Settings } from 'luxon';
import { DEFAULT_TIMEZONE } from '../defaults.js';

let currentTimezone = DEFAULT_TIMEZONE;

export function initializeTimezone(timezone: string): void {
  currentTimezone = timezone;
  Settings.defaultZone = timezone;
}

export function getTimezone(): string {
  return currentTimezone;
}
